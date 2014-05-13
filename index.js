
/**
 * Module dependencies.
 */
var path = require('path'),
    mkdirp = require('mkdirp'),
    _ = require('lodash'),
    Knex = require('knex'),
    Promise = require('bluebird');

exports = module.exports = init;

/**
 * Module initialization function.
 *
 * @public
 */
function init(config) {
  return new TiqDB(config);
}


/**
 * Main module object.
 *
 * @param {Object} config
 * @param {string} [config.client="sqlite3"] - The client for the chosen RDBMS.
 *     This can be one of "sqlite3", "pg" or "mysql".
 * @param {Object} [config.connection={}]
 * @param {string} [config.connection.host="localhost"]
 * @param {string} [config.connection.user=null]
 * @param {string} [config.connection.password=null]
 * @param {string} [config.connection.database="tiq"]
 * @param {string} [config.connection.filename="$XDG_DATA_HOME/tiq/store.db"] -
 *     The storage file to use. Only applicable to SQLite.
 * @constructor
 * @private
 */
function TiqDB(config) {
  var defaultConfig = {
      client: 'sqlite3',
      connection: {
        host: 'localhost',
        user: null,
        password: null,
        database: 'tiq',
        filename: path.join(process.env.XDG_DATA_HOME ||
            path.join(process.env.HOME, '.local', 'share'), 'tiq', 'store.db')
      }
    },
    config = _.merge(defaultConfig, config || {});

  // Setup the DB connection
  Knex.knex = Knex.initialize(config);
  this.config = config;
  return this;
}


/**
 * Connect to the database and create the schema if unavailable.
 */
TiqDB.prototype.enter = function() {
  // Make sure the storage directory exists if dealing with sqlite
  if (this.config.client == 'sqlite3') {
    mkdirp.sync(path.dirname(this.config.connection.filename));
  }

  this.schemaCreated = this.createSchema();
}


/**
 * Cleanup and close DB connection.
 */
TiqDB.prototype.exit = function() {
  // TODO: Wait for the connection pool to dry up before disconnecting.
  Knex.knex.client.pool.destroy();
}


/**
 * Create the DB schema.
 */
TiqDB.prototype.createSchema = function() {
  var tiq = this,
      knex = Knex.knex;

  return Promise.join(
    knex.schema.hasTable('tags').then(function(exists) {
      if (!exists) {
        return knex.schema.createTable('tags', function(t) {
          t.increments().primary();
          t.string('text', 1024).notNullable();
          t.string('namespace').notNullable();
          t.integer('count', 100).defaultTo(0);
          t.timestamps();
          t.unique(['text', 'namespace']);
        });
      }
    }),

    knex.schema.hasTable('tags_associations').then(function(exists) {
      if (!exists) {
        return knex.schema.createTable('tags_associations', function(t) {
          t.integer('tag_id1').notNullable();
          t.integer('tag_id2').notNullable();
          t.unique(['tag_id1', 'tag_id2']);
        });
      }
    })
  );
}


/**
 * Associate a collection of tokens with a collection of tags.
 *
 * Practically, tags and tokens are the same thing (arbitrary text). We just
 * treat them as different concepts to be able to associate them correctly.
 *
 * Each "tag" is associated with each "token", and each "token" is associated
 * with each "tag".
 *
 * @param {Array.<string>} tokens
 * @param {Array.<string>} tags
 * @param {string} [ns='public'] - Namespace used for all tags and tokens.
 */
TiqDB.prototype.associate = function(tokens, tags, ns) {
  if (!tokens.length || !tags.length) {
    return;
  }

  ns = ns || 'public';
  var tiq = this,
      knex = Knex.knex,
      allTags = _.uniq(tokens.concat(tags));

  return this.schemaCreated.then(function() {
    // Couldn't figure out a way to use Bluebird's `bind()` to maintain scope
    // within the promise handler functions, so we use this poor-man's version.
    var scope = {};
    return knex.transaction(function(trans) {
      // Fetch existing tags
      knex('tags').transacting(trans)
      .select('id', 'text').whereIn('text', allTags).andWhere('namespace', ns)
      .then(function(existingTags) {
        scope.existingTags = existingTags;
        // Create missing tags
        scope.missingTagsRaw = _.xor(allTags, _.pluck(existingTags, 'text'));
        if (scope.missingTagsRaw.length) {
          var now = new Date();
          var tagObjs = _.map(
            scope.missingTagsRaw, function(t) {
              return {text: t, namespace: ns,
                      created_at: now, updated_at: now}
            }
          );
          return knex('tags').transacting(trans).insert(tagObjs);
        }
      }).then(function(inserted) {
        // `inserted` is of not much use here, since it returns different things
        // depending on the client (see http://knexjs.org/#Builder-insert),
        // so we avoid using it and just run another query to get the newly
        // created tags.
        return knex('tags').transacting(trans)
          .select('id', 'text')
          .whereIn('text', scope.missingTagsRaw).andWhere('namespace', ns);
      }).then(function(missingTags) {
        scope.fetchedTags = scope.existingTags.concat(missingTags);
        // Fetch existing associations
        var tagIds = _.pluck(scope.fetchedTags, 'id');
        return knex('tags_associations').transacting(trans)
          .select('tag_id1', 'tag_id2').whereIn('tag_id1', tagIds);
      }).then(function(existingAssocs) {
        var associations = [],
            tokenIds = [],
            tagIds = [];

        // Extract all tag IDs
        _.forOwn(scope.fetchedTags, function(tag) {
          if (_.contains(tags, tag.text)) {
            tagIds.push(tag.id);
          } else {
            tokenIds.push(tag.id);
          }
        });

        // Build the association maps
        // We only need them one-way, as they'll be fetched backwards as well.
        _.each(tagIds, function(tid) {
          associations = associations.concat(
            _.map(tokenIds, function(t) {return {tag_id1: tid, tag_id2: t}})
          );
        });

        // Include only missing associations, to not trip the unique DB constraint
        scope.missingAssocs = _.filter(associations, function(assoc) {
          var notExists = true;
          for (var i=0; i < existingAssocs.length; i++) {
            if (_.isEqual(assoc, existingAssocs[i])) {
              notExists = false;
              break;
            }
          }
          return notExists;
        });

        if (scope.missingAssocs.length) {
          // Create the missing associations
          return knex('tags_associations').transacting(trans)
            .insert(scope.missingAssocs);
        }
      }).then(function(inserted) {
        // Increment the association count for each tag
        var tagIds = _.uniq(
          _.pluck(scope.missingAssocs, 'tag_id1').concat(
            _.pluck(scope.missingAssocs, 'tag_id2')
          )
        );
        return knex('tags').transacting(trans)
          .whereIn('id', tagIds)
          .update({
            'updated_at': new Date(),
            'count': knex.raw('count + 1')
          });
      }).then(function() {
        if (trans.connection) {
          trans.commit();
        }
      }, trans.rollback);
    });
  });
}


/**
 * Get the tags associated with the given tokens.
 *
 * @param {Array.<string>} tokens
 * @param {string} [ns='public'] - Namespace used for all tags and tokens.
 * @param {Object} [data={}]
 * @returns {Array} - Collection of associated tags.
 */
TiqDB.prototype.describe = function(tokens, ns, cb) {
  if (!tokens.length) {
    return;
  }

  ns = ns || 'public';
  var tiq = this,
      knex = Knex.knex,
      tokens = _.uniq(tokens);

  return this.schemaCreated.then(function() {
    /*
      We need individual selects for each token passed, so we can use intersect
      on them later. This could be simplified a lot and use a single query if
      Knex supported standard SQL 'intersect'. Basically, intersect these
      individual queries and wrap them up in another select to fetch the final
      text. We could accomplish this with raw queries, but we lose the abstraction
      and would have to deal with protecting against SQL injection ourselves.
    */
    var queries = [],
        // Select either forwards or backwards relation
        rawCase = knex.raw(
          '(case '
        +   'when tag_id1 = id then tag_id2 '
        +   'when tag_id2 = id then tag_id1 '
        + 'end) id'
        );
    _.each(tokens, function(tok) {
      queries.push(
        knex('tags_associations')
          .select(rawCase)
          .join('tags', function() {
            this.on('tag_id1', '=', 'id')
              .orOn('tag_id2', '=', 'id');
          }).where('text', tok).andWhere('namespace', ns)
      );
    });
    return Promise.all(queries);
  }).spread(function() {
    var args = arguments,
        allIds = [];

    // Extract all IDs from queries results
    for (var i=0; i<args.length; i++) {
      var ids = [];
      for (var j=0; j<args[i].length; j++) {
        ids.push(args[i][j].id);
      }
      allIds.push(ids);
    }

    // Only IDs that exist in *all* results
    return _.intersection.apply(this, allIds);
  }).then(function(ids) {
    return knex('tags')
      .select('text')
      .whereIn('id', ids).pluck('text');
  });
}

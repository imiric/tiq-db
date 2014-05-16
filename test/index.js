
/**
 * Module dependencies.
 */

var tiq = require('..')({connection: {filename: ':memory:'}}),
    knex = require('knex').knex,
    Promise = require('bluebird'),
    _ = require('lodash'),
    should = require('chai').should();

beforeEach(function() {
  return tiq.createSchema().then(function() {
    return Promise.join(
      knex.raw('delete from tags'),
      knex.raw('delete from tags_associations'),
      knex.raw("delete from sqlite_sequence where name = 'tags'"),
      knex.raw("delete from sqlite_sequence where name = 'tags_associations'")
    );
  });
})

describe('TiqDB#associate', function() {
  it('should associate tags with tokens', function(done) {
    return tiq.associate(['john'], ['hello', 'yes']).then(function() {
      return knex('tags').select('text').pluck('text').then(function(tags) {
        tags.should.deep.equal(['john', 'hello', 'yes']);
        return knex('tags_associations');
      }).then(function(assocs) {
        var ids = [];
        _.each(assocs, function(a) {
          ids.push(_.values(a));
        });
        ids.should.deep.equal([[2, 1], [3, 1]]);
        done();
      });
    });
  })

  it('should associate tags with tokens using namespaces', function(done) {
    return tiq.associate(['john'], ['hello', 'yes'], 'private').then(function() {
      return knex('tags').select('text', 'namespace').then(function(tags) {
        var cleanTags = [];
        _.each(tags, function(t) {
          cleanTags.push(_.values(t));
        });
        cleanTags.should.deep.equal([
          ['john', 'private'], ['hello', 'private'], ['yes', 'private']
        ]);
        return knex('tags_associations');
      }).then(function(assocs) {
        var ids = [];
        _.each(assocs, function(a) {
          ids.push(_.values(a));
        });
        ids.should.deep.equal([[2, 1], [3, 1]]);
        done();
      });
    });
  })

  it('should associate only unique values', function(done) {
    return Promise.join(
      tiq.associate(['john'], ['hello', 'yes']),
      tiq.associate(['another'], ['john', 'peter']),
      knex('tags').select('text').pluck('text').then(function(tags) {
        tags.should.deep.equal(['john', 'hello', 'yes', 'another', 'peter']);
        return knex('tags_associations');
      }).then(function(assocs) {
        var ids = [];
        _.each(assocs, function(a) {
          ids.push(_.values(a));
        });
        ids.should.deep.equal([[2, 1], [3, 1], [1, 4], [5, 4]]);
        done();
      })
    );
  })

  it('should not create duplicate associations if tags are passed in reverse', function(done) {
    return Promise.join(
      tiq.associate(['john'], ['hello']),
      tiq.associate(['hello'], ['john']),
      knex('tags').select('text').pluck('text').then(function(tags) {
        tags.should.deep.equal(['john', 'hello']);
        return knex('tags_associations');
      }).then(function(assocs) {
        var ids = [];
        _.each(assocs, function(a) {
          ids.push(_.values(a));
        });
        ids.should.deep.equal([[2, 1]]);
        done();
      })
    );
  })
});

describe('TiqJSON#describe', function() {
  beforeEach(function() {
    return Promise.join(
      knex('tags').insert([
        {text: 'peter', namespace: 'public'},
        {text: 'what',  namespace: 'public'},
        {text: 'peter', namespace: 'private'},
        {text: 'nope',  namespace: 'private'}
      ]),
      knex('tags_associations').insert([
        {tag_id1: 1, tag_id2: 2},
        {tag_id1: 3, tag_id2: 4}
      ])
    );
  })

  it('should return the tags associated with the tokens', function(done) {
    return tiq.describe(['what']).then(function(tags) {
      tags.should.deep.equal(['peter']);
      return tiq.describe(['peter']);
    }).then(function(tags) {
      tags.should.deep.equal(['what']);
      done();
    })
  })

  it('should return the tags associated with the tokens using namespaces', function(done) {
    return tiq.describe(['nope'], 'private').then(function(tags) {
      tags.should.deep.equal(['peter']);
      return tiq.describe(['peter'], 'private');
    }).then(function(tags) {
      tags.should.deep.equal(['nope']);
      done();
    })
  })
});

describe('TiqJSON#search', function() {
  beforeEach(function() {
    return knex('tags').insert([
      {text: 'http://duckduckgo.com/', namespace: 'public'},
      {text: 'http://ducksrus.com/',   namespace: 'public'},
      {text: 'introDUCKtion',          namespace: 'public'},
      {text: 'I am a cat',             namespace: 'public'},
      {text: 'The Mighty Ducks',       namespace: 'private'},
      {text: 'I am a cat too... not!', namespace: 'private'},
    ]);
  })

  it('should return tags matching the text', function(done) {
    return tiq.search('duck').then(function(tags) {
      tags.should.deep.equal([
        'http://duckduckgo.com/',
        'http://ducksrus.com/',
        'introDUCKtion'
      ]);
      done();
    })
  })

  it('should return tags matching the text using namespaces', function(done) {
    return tiq.search('CAT', 'private').then(function(tags) {
      tags.should.deep.equal(['I am a cat too... not!']);
      done();
    })
  })
});

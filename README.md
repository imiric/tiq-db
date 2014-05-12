tiq-db
======

This is a database storage plugin for [tiq](http://github.com/imiric/tiq).

It uses the [Knex](http://knexjs.org/) library so it can be used to store
`tiq` data in either SQLite, PostgreSQL or MySQL.


Setup
-----
```
npm install -g tiq-db
```

Then, depending on the RDBMS you want to use, install one of the following:
```
npm install -g <sqlite3|pg|mysql>
```


Configuration
-------------

Here are the configuration options you can pass to this plugin:

- `client`: The RDBMS client you chose. One of `"sqlite3"`, `"pg"` or `"mysql"`.
    [default: `"sqlite3"`]
- `connection.host`: Host name or IP address to connect to.
    [default: `"localhost"`]
- `connection.user`: Username used to connect to the host. [default: `null`]
- `connection.password`: Password used to connect to the host. [default: `null`]
- `connection.database`: Database name to use. [default: `"tiq"`]
- `connection.filename`: The storage file to use. Only applicable to SQLite.
    [default: `"$XDG_DATA_HOME/tiq/store.db"`]

The options are passed as-is to
[Knex.initialize](http://knexjs.org/#Initialize), so you can include additional
options as needed.


License
-------

[MIT](LICENSE)

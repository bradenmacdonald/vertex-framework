# Architecture/Decisions: Graph Data

Vertex Framework is a tool for working with data stored in a Neo4j graph database.

## VNodes

All data is represented as either a node in the graph or a relationship between nodes.

This application uses only strongly typed nodes, which are called "VNodes" (not to be confused with Neo4j's [`vNode`](https://neo4j.com/labs/apoc/4.1/overview/apoc.create/apoc.create.vNode/)). Each type of node (each VNode type) has a label (e.g. `User`), a schema (set of allowed/required properties and relationships), and validation (arbitrary code to check constraints).

Every VNode is identified by a UUID.

* Neo4j node IDs are meant for internal use only and are not suitable for this purpose (they can be recycled etc.)
* UUIDs allow the client to generate its own ID in advance of writing to the database, which can be handy for e.g. offline edits

Some VNodes are also identified by a `shortId`, which is a short slug-like string such as `bob` or `boeing-747`. The "current" `shortId` of a VNode may be changed (e.g. a user changing their username, or an article changing its URL slug), but previously used `shortId`s will continue to work and point to the same VNode.

In order to prevent any ambiguity between UUIDs and `shortId`s, `shortId`s are required to be shorter than UUID strings. A UUID string like `00000000-0000-0000-0000-000000000000` is 36 characters long, so shortIds are limited to 32. In addition, `shortId`s are restricted to basic English alphanumeric characters as well as hyphens and periods. Underscores are not allowed as they can be hard to see when text is underlined. `^[A-Za-z0-9.-]{1,32}$` is the regular expression for validating `shortId`s.

* This allows a nice mix of friendly, changeable, human-readable identifiers that are also permanent - an external system that points to a URL containing a shortId will never result in a broken link because the shortId was changed, since every shortId works forever.
* There is no ambiguity between a `shortId` (≤32 characters) and a UUID (36 characters), so APIs can be made to accept either.

Schema field/property definitions and basic validation are done using [Joi](https://joi.dev/). Additional validation rules for each VNode type consist of arbitrary code and checks, and can include additional graph queries as needed.

* Joi validation rules can be written once and then used at the graph database level, the REST API request/response shape level, and on the frontend.

When a VNode is "deleted", its label is changed, e.g. from `User` to `DeletedUser`. This preserves data and relationships and makes code for un-deleting/restoring nodes simpler.

## Reading Data

Any code in the application is welcome to read from the database at any time, and use any methods to query the nodes and relationships in the database.

Vertex Framework provides three different APIs for reading data, where `tx` represents a read transaction:

* `tx.run(query, params)` - run a query on the database, using the native Neo4j driver directly
* `tx.query(query, params, returnShape)` and `tx.queryOne` - run a query on the database, and return a typed response, with the shape specified by `returnShape`. With the `query` methods, the syntactic sugar `(node)::{$key}` is supported for doing a lookup by either UUID or shortId, and the query's `RETURN` clause can be automatically generated based on `returnShape`
* `tx.pull(dataRequest, filter)`, `tx.pull(VNodeType, shapeSpec, filter)` and `tx.pullOne` - retrieve nodes, properties, and "virtual properties" from the database. With the `pull` methods, the Cypher code for the query is generated fully automatically, and a fully typed response is provided.

## Writing/Mutating Data: Actions

A migrations framework is used to define the database schema and apply some occasional data migrations. Other than that, **all changes (writes) to the database are done via "Actions"**. An Action is a mutation to the database such as "Create User", "Edit Article", etc.

* This "Actions" framework is an instance of the "command pattern". It provides consistency (all mutations happen via the same mechanism), auditability, history, and reversability.

Each Action tracks carefully which VNodes it modifies, and then validation of each modified VNode is done before the write transaction is committed. Every Action successfully applied to the graph is itself a VNode, written into the graph, with a `MODIFIED` relationship pointing to each VNode it created, modified, or deleted.

* This provides a complete change history of every VNode and its relationships.
* This provides fairly strong schema enforcement which Neo4j otherwise does not support (although changes to the validation schema do not apply retroactively, and it relies on actions accurately declaring which VNodes they have modified).

Actions can generally be "inverted" to create a new Action that undoes the original action. This, in combination with the Action log/history, allows auditing and reverting changes to the graph as needed.

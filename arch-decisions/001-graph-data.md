# Architecture/Decisions: Graph Data

Vertex Framework is a tool for working with data stored in a Neo4j graph database.

## VNodes

All data is represented as either a node in the graph or a relationship between nodes.

This application uses only strongly typed nodes, which are called "VNodes" (not to be confused with Neo4j's [`vNode`](https://neo4j.com/labs/apoc/4.1/overview/apoc.create/apoc.create.vNode/)). Each type of node (each VNode type) has a label (e.g. `User`), a schema (set of allowed/required properties and relationships), and validation (arbitrary code to check constraints). Every VNode also has the `VNode` label.

Every VNode has a unique permanent identifier string ("VNID", VNode ID - see "003-identifiers").

Schema field/property definitions and basic validation are done using [Joi](https://joi.dev/). Additional validation rules for each VNode type consist of arbitrary code and checks, and can include additional graph queries as needed.

* Joi validation rules can be written once and then used at the graph database level, the REST API request/response shape level, and on the frontend.

When a VNode is "deleted", its `VNode` label is changed to `DeletedVNode`. This preserves data and relationships and makes code for un-deleting/restoring nodes simpler.

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

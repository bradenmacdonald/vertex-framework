# Vertex Framework

Vertex Framework is a prototype web application framework being developed for use by the [TechNotes](https://technotes.org) application backend.

Its design choices are oriented around the TechNotes use case and probably not suitable for general use at this time. It's mostly in a separate repository for cleaner separation of concerns and tests.

Consider it very unstable and with an API that will feature regular breaking changes.

## Features of Vertex Framework

* Data is stored in a graph database, specifically Neo4j because its Cypher language is the most enjoyable to work with.
* Coded in TypeScript, with a fully-typed API
* Focus on data integrity and traceability: uses the command pattern, so the database can only ever be modified via "Actions" (similar to GraphQL Mutations), and every Action is recorded in the database with a record of what node(s) it modified. This means you can get a complete change history of every node in the graph, that details who changed it, when, and how. Also includes support for "inverting" actions, giving "Undo" capability to everything in the system.
* Not tied to any specific HTTP framework, though it's designed to integrate well with [Hapi](https://hapi.dev/) and [hapi-swagger](https://github.com/glennjones/hapi-swagger)
* No ORM (you get to use the full power of Cypher), but it does have high-level functions that make it easy to performantly pull data from the graph, only grabbing the data you need (like GraphQL) but with fully typed responses (TypeScript and/or OpenAPI). It also includes tooling to auto-generate common CRUD Actions for your models.

# Vertex Framework: layers

Vertex Framework's code has a lot of different parts that interact with each other. In order to keep the codebase maintainable, the implementation has been split into several "layers", where each layer only uses code from the layers "below" it. For example, code in layer 2 does not depend on any concepts from layers 3 or 4.

The layers are as follows:

* **Layer 1**: conceptually this refers to the standard Neo4j JavaScript API - it's what Vertex Framework is built on.
* **Layer 2**: Cypher syntactic sugar, `BaseVNodeType`, database constraints/schema for `:VNode`, `VNodeTypeRef`.
  * `BaseVNodeType` is the base class that gets extended to become the full `VNodeType` in layer 4; layers 2-3 can use the base type in place of the full type.
* **Layer 3**: Actions, action runner, action templates, action helper methods, base data request (used to specify which "raw" properties are used in default actions), triggers that enforce Action rules.
* **Layer 4**: Virtual properties, derived properties, the full `VNodeType` class, and `pull()`/`pullOne()` plus supporting code like "data request mixins" and `DataResponse`

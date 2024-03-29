# Vertex Framework

## Type Safe Application Framework for Neo4j and Deno

**Vertex Framework** is a graph data management framework, originally developed for use by the [Neolace](https://www.neolace.com) platform. It sits between a [Deno/TypeScript](https://deno.land/) application and a [Neo4j graph database](https://neo4j.com/), and it provides **type safety** (which Neo4j doesn't) and convenience methods for accessing graph data (which Neo4j doesn't).

![Diagram showing vertex framework between the Application and the Neo4j database](./docs/images/overview.svg)

---

Here are some of the features that Vertex Framework provides:

## Data integrity and schema

Neo4j has relatively minimal support for enforcing schema constraints. Vertex Framework implements a layer of schema definition and validation on top of Neo4j, providing your application with all the benefits that strongly typed data brings.

Every node in your data graph that Vertex Framework manages is called a `VNode` and must comply with one or more VNode types defined by your application. All `VNode`s have the `:VNode` label and at least one other label, as well as a property called `id` which holds a `VNID` (a type of UUID) as their primary key (see details in the next section).

Here is an example of how an application can define a `VNode` type and its schema:

```typescript

/**
 * A Person VNode type
 */
export class Person extends VNodeType {
    static label = "Person";
    static properties = {
        ...VNodeType.properties,
        name: Field.String,
        dateOfBirth: Field.Date,
    };
    static rel = this.hasRelationshipsFromThisTo({
        /** This Person acted in a given movie */
        ACTED_IN: {
            to: [Movie],
            properties: {
                role: Field.String,
            },
        },
        /** This Person is a friend of the given person (non-directed relationship) */
        FRIEND_OF: {
            to: [Person],
            properties: {},
            cardinality: VNodeType.Rel.ToManyUnique,
        },
    });
    static defaultOrderBy = "@this.name";
}

```

When any change is made to a VNode with the `Person` label, Vertex framework will validate this schema within the transaction. If the change created a `Person` VNode that was missing the required `name` property, or that had a `FRIEND_OF` relationship pointing to a `Movie` VNode, or any other schema violation, the transaction will fail validation and will not be committed.

## Primary keys (VNIDs)

_Every_ VNode has a unique, permanent identifier in its `id` field, of type `VNID`. The VNID identifier type/format is a string that starts with a "_" and is up to 23 characters long (minimum length is 2 characters, but most VNIDs are 20-23 characters long). VNIDs are just a special encoding of v4 UUIDs (in base 62 with an underscore prefix).

Example VNID values:

* `_XtzOcazuJbitHvhviKM`
* `_VuIbH1qBVKPl61pzwd1wL`
* `_3DF8hceEobPFSS26FKl733`
* `_0` (the "null VNID" is a special value reserved by Vertex Framework for special purposes)

Why VNIDs?

* Neo4j node IDs are meant for internal use only and are not suitable for this purpose (they can be recycled etc.).
* VNIDs are a type of UUID, so allow the client to generate its own ID in advance of writing to the database, which can be handy for e.g. offline edits.
* VNIDs are more compact than UUIDs, so slightly more efficient in databases like neo4j that lack a proper UUID datatype and use strings instead.
* VNIDs are seen as a single "word" in text editors so can be easily selected by double-clicking, unlike UUIDs.

## Data traceability (Actions)

While *reading* from the graph database is completely unrestricted, *writing* to the database managed by Vertex Framework is only possible via **Actions**.

An **`Action`** represents a change to the database, such as "Create User", "Update User Profile", "Edit Article", and so on. (Actions are similar to GraphQL "Mutations", and are also "Commands" in the more general [Command Pattern](https://en.wikipedia.org/wiki/Command_pattern).) When an `Action` is run, data about the Action itself is saved into the graph, such as what user ran the action, when the action ran, how long it took to process, and what nodes it modified. This means that it's trivial to look up an ordered list of actions that have modified any given node in the graph, giving the complete change history of that node.

Vertex Framework uses [APOC triggers](https://neo4j.com/docs/apoc/current/background-operations/triggers/) to enforce this constraint, i.e. to ensure that the database cannot be modified other than through Actions, and that Actions must always indicate which nodes they have modified.

## Auto-generated Actions

Nobody likes boilerplate. Vertex Framework can auto-generate Actions for common CRUD operations and provides helpers functions that make it easy to write custom actions that modify properties and relationships.

For example, to create `CreatePerson` and `UpdatePerson` actions for the `Person` VNode type shown above, the code needed is simply:

```typescript
export const UpdatePerson = defaultUpdateFor(Person, p => p.name.dateOfBirth);

export const CreatePerson = defaultCreateFor(Person, p => p.name, UpdatePerson);
```

In the first line, `p.name.dateOfBirth` is specifying which `Person` fields the auto-generated `UpdatePerson` action should be able to update. It's fully typed, so as you type `p => p.` in your IDE, you'll get a dropdown showing you the available fields, and if you refactor your `Person` schema but still reference an old field here, TypeScript will show an error. In the second line, `p => p.name` is speciyfing that the `name` property is required and must be specified when running the `CreatePerson` action. Other properties defined in the `UpdatePerson` action can also be passed in, but will be optional:

![Screenshot showing auto-completion in an IDE](./docs/images/readme-autogen-action.png)

## Cypher syntactic sugar

Whether you're writing actions to modify the database or just queries to read data from the database, you'll be enjoying the power and flexibility of Cypher. While you can of course use "plain" Cypher and the regular Neo4j JavaScript API, Vertex Framework provides a lot of syntactic sugar that makes it simpler to write queries, helps you avoid typos, and provides fully typed data.

Here is a query using "plain" Cypher:

```typescript
const firstMovieTitle = await graph.read(async tx => {

    const result = await tx.run(`
        MATCH (p:Person:VNode {id: $id})
        MATCH (p)-[:ACTED_IN]->(movie:Movie:VNode)
        RETURN movie
    `, {
        id: personId,
    });

    return result.records[0].get("movie").title;
});
// Type of "firstMovieTitle" is now "any" 😔
```

And here is the same query using the optional syntactic sugar:

```typescript
const firstMovieTitle = await graph.read(async tx => {

    const result = await tx.queryOne(C`
        MATCH (p:${Person} {id: ${personId}})
        MATCH (p)-[:${Person.rel.ACTED_IN}]->(movie:${Movie})
    `.RETURN({movie: Field.VNode(Movie)}));

    return result.movie.title;
});
// Type of "firstMovieTitle" is now "string" 🚀
```

This second example shows:

* TypeScript knows what fields are available on the returned `movie` record, and the types of each, such as the `title` field which is a `string`.
* Variables like `personId` can be interpolated directly into the query - there's no need to define a neo4j parameter variable like `$id` and then pass a separate object with parameter values. You can rest assured that the data values are still passed as parameters though, ensuring that query plans can be re-used and your application is safe against Cypher injection attacks.
* Instead of hard-coding labels and relationship types, you can interpolate a `VNode` type and its relationship definitions. The syntactic sugar code knows that these are labels, not parameters, and will replace `:${Person}` with the correct `:Person:VNode` label, and similar for relationships.
  * This has the advantage that if you make any typo or reference a relationship that has been renamed, etc., TypeScript will immediately highlight your error, making query writing and refactoring easier.
  * If you're wondering why `:${Person}` gets replaced with both `:Person` and `:VNode` labels, that is required since only `:VNode` has an index on VNIDs, and Vertex Framework allows you to optionally handle data "deletion" by keep data around but removing the `:VNode` label.)

For complex custom queries, `.givesShape` can be used to specify arbitrary return types that TypeScript will be aware of, though the syntax is a little more verbose:

```typescript
const result = await tx.query(C`
    MATCH (p:${Person} {id: ${personId}})
    MATCH (p)-[rel:${Person.rel.ACTED_IN}]->(m:${Movie})
    RETURN {title: m.title, role: rel.role} AS movie
`.givesShape({
    movie: Field.Record({title: Field.String, role: Field.String}),
}));
// Type of "result" is Array<{movie: {title: string; role: string;}}>
```

## Virtual properties, derived properties, and data pulls

Of course, we don't want to have to write a Cypher query every time we need some piece of data from the graph. Vertex Framework provides some additional features to make your life easy when reading VNode data.

First, when defining a `VNode` type/schema, you can also specify **virtual properties** and **derived properties**, like this:

```typescript

/**
 * A Person VNode type
 */
export class Person extends VNodeType {

    ... // label, properties, rel, defaultOrderBy as shown above

    static virtualProperties = this.hasVirtualProperties({
        // The movies that this person has acted in:
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[@rel:${this.rel.ACTED_IN}]->(@target:${Movie})`,
            relationship: this.rel.ACTED_IN,
            target: Movie,
        },
        // Costars: people who have acted in the same movies as this person:
        costars: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${this.rel.ACTED_IN}]->(:${Movie})<-[:${this.rel.ACTED_IN}]-(@target:${Person})`,
            target: this,
        },
        // Friends of this person:
        friends: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${this.rel.FRIEND_OF}]-(@target:${Person})`,
            target: this,
        },
        // Compute this person's age (using Cypher)
        age: {
            type: VirtualPropType.CypherExpression,
            cypherExpression: C`duration.between(date(@this.dateOfBirth), date()).years`,
            valueType: "number" as const,
        }
    });

    static derivedProperties = this.hasDerivedProperties({
        numSameAgeFriends,
    });
}

/**
 * A "derived property" that computes the number of this person's friends that are the same age.
 * This computation happens in JavaScript, not Cypher.
 */
function numSameAgeFriends(): DerivedProperty<number> { return DerivedProperty.make(
    // What VNodeType this derived property works for:
    Person,
    // Dependencies: Define what data this derived property needs:
    p => p.age().friends(f => f.age()),
    // Computation: how to compute the value of this derived property for each Person:
    p => {
        // TypeScript knows that the type of "p" here is:
        // p: { age: number; friends: ({ age: number; })[]; }
        return p.friends.filter(f => f.age === p.age).length;
    }
)}

```

**Virtual properties** as shown above can represent relationships to other nodes (either -to-many or -to-one relationships), or Cypher expressions such as the `age` virtual property shown in this example. Virtual properties are defined using Cypher expressions, with the special placeholder variables `@this`, `@rel`, and `@target` available to specify the current node, a relationship used in the result, and the target node respectively.

**Derived properties** are like virtual properties but are computed by Vertex Framework after data has been fetched from the database, before returning it to your application. Each derived property can define dependencies, i.e. regular properties and/or virtual properties that it needs to compute its value. Each derived property also defines a computation function that uses the data retrieved from the database to compute its value. In the example shown above, the `numSameAgeFriends` derived property declares a dependency on the person's `age` as well as the person's list of friends and the age of each friend. It then uses that data to produce a `number` typed result.

### Reading data from the graph

With regular ("raw"), virtual, and derived properties all defined in the VNode type definition, your application can now use the `pull()` and `pullOne()` methods to read data from the database, while specifying the exact data shape you'd like. This works similarly to a GraphQL query but is fully integrated into TypeScript, with no need for code generation.

Examples:

As you type out a call to `pull()`, your IDE will prompt you with available properties:

<img src="./docs/images/readme-pull-dropdown.png" width=700 alt="Screenshot showing IDE autocompletion">

A complete call to `pull()`, to look up a specific person and information about their costars looks like this:

<img src="./docs/images/readme-pull-result-dropdown.png" width=700 alt="Screenshot showing call to pull() and result data">

As you can see, everything is fully typed and TypeScript is aware of all available fields and the exact shape of the data returned by the query.

The syntax of specifying properties with `pull()` and anywhere else in vertex framework is that regular ("raw") properties are just chained like `person.name.dateOfBirth.id`, but virtual and derived properties are chained as method calls like `person.age().numSameAgeFriends()`. If the virtual property is a relationship, then it's necessary to pass in parameters to determine the shape of data you want from the target VNode type as well (e.g. `p.friends(f => f.name)` to specify that the name of each friend is to be loaded.)

`pull()` and `pullOne()` are nearly identical, but `pull()` always returns an array and `pullOne()` always returns a single result (and throws an error if the query returns anything other than a single result).

A note on **design goals for pull()**: pull() is designed to make common data retrieval cases easy, consistent, centrally defined (in the VNode model), and fully typed, but it is not designed as a complete replacement for Cypher. For any very complex lookups or features that pull() doesn't support, just use Cypher directly, along with all the other syntactic sugar and typing support that Vertex Framework provides.

## Projected virtual properties

If your VNode type defines properties in its relationship schema, and then references that relationship in a virtual property:

```typescript
    static rel = this.hasRelationshipsFromThisTo({
        ...
        ACTED_IN: {
            to: [Movie],
            properties: {
                // Properties stored on the relationship:
                role: Field.String,
            },
        },
    ...
    static virtualProperties = this.hasVirtualProperties({
        ...
        movies: {
            type: VirtualPropType.ManyRelationship,
            target: Movie,
            query: C`(@this)-[@rel:${Person.rel.ACTED_IN}]->(@target:${Movie})`,
            //                ^^^^ special relationship variable
            relationship: Person.rel.ACTED_IN,
        },
```

Then when you call pull() via that virtual relationship (`movies` in this example), any properties from the relationship will be "projected" onto the target VNode and available for you to use. So in this case, the `role` string property will appear on the target `Movie` VNodes, although it's coming from the relationship and is not a property of the `Movie` VNode:

<img src="./docs/images/readme-pull-result-projected.png" width=700 alt="Screenshot showing call to pull() and result data with a projected virtual property">

## Conditional Properties

If you're designing an API and you want to include some data in the result that is expensive to compute, you might want to make it optional, so that clients can choose whether or not they need that data. Vertex Framework makes this easy, with built in support for conditionally retrieving properties based on **flags**.

Here's an example:

```typescript
const flags = request.GET["flags"]?.split(",") || [];

const result = await graph.pull(Person, p => p
    .id
    .name
    .dateOfBirth
    .if("includeFriends", p => p
        .friends(f => f.id.name.dateOfBirth)
        .numSameAgeFriends()
    ),
    {flags,}
);
```

With that example, each entry in the result array will have optional `friends` and `numSameAgeFriends` properties, which may or may not be available at runtime depending on whether or not `?flags=includeFriends` was specified by the request.

Conditional properties are designed to partially provide one of the big features of GraphQL - that API clients can specify which fields they need - in a REST API, while also ensuring that the application has full control over what queries are allowed and what data can be returned.

## Inheritance

If you define a VNode schema that uses inheritance (e.g. `Planet` is a subclass of `AstronomicalBody` is a subclass of `VNodeType`), you should find that Vertex Framework handles it well, and everything "just works".

To make this possible, you'll notice that the default Create action will give each VNode several labels: the label of its type, as well as of every inherited type. (So a `Planet` VNode would have labels `:Planet:AstronomicalBody:VNode`.) If you write your own create action, you'll need to ensure that you assign the appropriate labels from every parent class too (you'll get an error if you don't).

Also, when defining the properties, relationships, virtual properties, and derived properties of your subclass, if different from the parent class, you'll need to explicitly include the inherited ones, like this:

```typescript
    static derivedProperties = this.hasDerivedProperties({
        ...ParentClass.derivedProperties,  // <-- add this line
        numSameAgeFriends,
    });
```

## Migrations

Vertex Framework includes a rudimentary migrations framework that your application can use to modify the database schema, for example to add a unique constraint on a particular property or to do a data migration if some fields/VNode types have been renamed.

Here is an example of how to initialize Vertex Framework with a custom migration:

```typescript
import { Vertex } from "vertex-framework";
import { config } from "../app/config";

export const graph = new Vertex({
    neo4jUrl: config.neo4jUrl,
    neo4jUser: config.neo4jUser,
    neo4jPassword: config.neo4jPassword,
    extraMigrations: {
        // Users have unique email addresses:
        userEmailUnique: {
            forward: async (dbWrite) => {
                await dbWrite(async tx => {
                    await tx.run("CREATE CONSTRAINT user_email_uniq ON (u:User) ASSERT u.email IS UNIQUE");
                });
            },
            backward: async (dbWrite) => {
                await dbWrite(tx => tx.run("DROP CONSTRAINT user_email_uniq"));
            },
            dependsOn: [],
        },
    },
});
```

## Dealing with circular references

When creating a Node.js/TypeScript project, circular references can be a big pain. Often they are only detectable at runtime, resulting in strange bugs where some class in your code is unexpectedly `undefined`.

Due to Vertex Framework's design that tries to provide as much type information as possible, there will be times when circular references to `VNodeType` classes come up in your code, sometimes unavoidably. Vertex Framework has a couple of features to help reduce this pain:

* Cypher syntactic sugar will lazily evaluate interpolated classes/values as late as possible, so a reference like `` C`MATCH (p:${Person})` `` will not evaluate `Person` right away (as it be undefined during module import), but instead will wait until the query actually needs to be compiled and executed, and then evaluate it.
* Some other types of circular references will be detected at runtime and Vertex Framework will throw an exception clearly stating that the problem is most likely a circular reference.

If you have an unavoidable circular reference, Vertex Framework provides a simple tool for solving the problem: **forward references** to VNodeTypes. For example, say you have a `Movie` VNodeType which has a -to-one relationship to `MovieFranchise`. You want `Movie` to have a `.franchise` virtual property to get the movie's franchise, but you also want the `MovieFranchise` VNodeType to have a `.movies` property to get the movies in that franchise. Here's how you can define both VNodeTypes using a forward reference:

In `Movie.ts`:

```typescript
import { VNodeType, VNodeTypeRef } from "vertex-framework";

// There is a circular reference between Movie and MovieFranchise, so declare a
// forward reference now:
export const MovieRef: typeof Movie = VNodeTypeRef();
// _now_ we can import MovieFranchise without circular references:
import { MovieFranchise } from "./MovieFranchise";
// but now we must resolve the forward reference:
VNodeTypeRef.resolve(MovieRef, Movie);


// Define Movie now:
export class Movie extends VNodeType {
    static label = "Movie";
    ...
    static rel = this.hasRelationshipsFromThisTo({
        /** This Movie is part of a franchise */
        FRANCHISE_IS: {
            to: [MovieFranchise],
            properties: {},
            cardinality: VNodeType.Rel.ToOneOrNone,
        },
    });
    static virtualProperties = this.hasVirtualProperties({
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${this.rel.FRANCHISE_IS}]->(@target:${MovieFranchise})`,
            target: MovieFranchise,
        },
    });
}
```

Then, in `MovieFranchise.ts`:

```typescript
// Instead of importing Movie, which would cause a circular reference,
// we import MovieRef:
import { MovieRef as Movie } from "./Movie";

export class MovieFranchise extends VNodeType {
    static label = "MovieFranchise";
    ...
    static virtualProperties = this.hasVirtualProperties({
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)<-[:${Movie.rel.FRANCHISE_IS}]-(@target:${Movie})`,
            target: Movie,
        },
    });
}
```

You should then generally be able to use `MovieRef` anywhere you would use `Movie`; behind the scenes, `MovieRef` is created as an ES6 `Proxy` object, which becomes a proxy for the real `Movie` class.

---

## Roadmap

Future improvements planned for Vertex Framework:

* Optimize performance of TypeScript typing (currently slow in some complex cases)
* Consolidate the `pull()` and `query()` APIs
* A mechanism for actions that have side effects
* "Standard" virtual properties like "DateCreated", "ChangeHistory", etc. available on all VNodes
* "Preview" transactions: open a non-committable transaction (that doesn't take write locks) so that the database can be queried as if some action(s) were applied, to preview and validate their effects without committing them.

## License

MIT

## Contributing

If you're interested in this project, contributions and help are welcome! Please feel free to open a GitHub issue or pull request, or to reach out to Braden at braden@neolace.com.

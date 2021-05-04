# VNode Identifiers

## VNID

_Every_ VNode has a unique, permanent identifier in its `id` field, of type `VNID`. The VNID identifier type/format is a string that starts with a "_" and is up to 23 characters long (minimum length is 2 characters, but most VNIDs are 20-23 characters long). VNIDs are just a special encoding of v4 UUIDs (in base 62 with an underscore prefix).

Example VNID values:

* `_XtzOcazuJbitHvhviKM`
* `_VuIbH1qBVKPl61pzwd1wL`
* `_3DF8hceEobPFSS26FKl733`
* `_0` (the "null VNID" is a special value reserved by Vertex Framework for special purposes)

Why VNIDs?

* Neo4j node IDs are meant for internal use only and are not suitable for this purpose (they can be recycled etc.)
* VNIDs are a type of UUID, so allow the client to generate its own ID in advance of writing to the database, which can be handy for e.g. offline edits
* VNIDs are more compact than UUIDs, so slightly more efficient in databases like neo4j that lack a proper UUID datatype and use strings instead.
* VNIDs are seen as a single "word" in text editors so can be easily selected by double-clicking, unlike UUIDs

## SlugId

Some VNodes are also identified by a `slugId`, which is a short slug-like string such as `bob` or `boeing-747`. Using a `slugId` optional per VNodeType, so some VNodeTypes will use them and others won't.

**The "current" `slugId` of a VNode may be changed** (e.g. a user changing their username, or an article changing its URL slug), but **previously used `slugId`s will continue to work** and point to the same VNode (provided you use Vertex Framework APIs and the special `HAS KEY` Cypher syntax for looking up VNodes by slugId).

* This allows a nice mix of friendly, changeable, human-readable identifiers that are also permanent - an external system that points to a URL containing a slugId will never result in a broken link because the slugId was changed, since every slugId works forever.
* There is no ambiguity between a `slugId` (cannot contain underscores) and a VNID (starts with an underscore), so APIs can be made to accept either (see "Keys" below).

### Characters allows in a slugId

SlugIds support unicode characters but cannot contain spaces, underscores, or most punctuation other than hyphens. The regular expression used to validate a slugId is:

```javascript
/^[-\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]+$/u
```

For particular use cases, applications may apply more restrictions on specific uses of slugIds (e.g. don't allow uppercase), but may not relax the restrictions (e.g. cannot allow spaces).

## Key

A **Key** in the context of Vertex Framework refers to **either a VNID or a slugId**. Many APIs will accept either form of identifier when looking up a VNode.

## HAS KEY Lookup

To facilitate looking up a VNode using a "Key" (its VNID, its current slugID, or any past slugId value), Vertex Framework provides a special Cypher syntax extension, which is used like this:

```cypher
MATCH (vn:VNode), vn HAS KEY $value
```

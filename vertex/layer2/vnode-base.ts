import * as Joi from "@hapi/joi";
import { UUID } from "../lib/uuid";
import { WrappedTransaction } from "../transaction";
import { C } from "./cypher-sugar";

/** Strict UUID Validator for Joi */
export const uuidValidator: Joi.CustomValidator = (stringValue, helpers) => {
    if (stringValue !== UUID(stringValue)) {
        throw new Error("UUID is not in standard form.");
    }
    return stringValue;
};

// Every VNode is uniquely and permanently identified by a UUID
export const UuidProperty = Joi.string().custom(uuidValidator);
// In order to prevent any ambiguity between UUIDs and shortIds, shortIds are required to be shorter than UUID strings
// A UUID string like 00000000-0000-0000-0000-000000000000 is 36 characters long, so shortIds are limited to 32.
export const ShortIdProperty = Joi.string().regex(/^[A-Za-z0-9.-]{1,32}$/).required();
// An empty object that can be used as a default value for read-only properties
export const emptyObj = Object.freeze({});

/**
 * Abstract base class for a "VNode".
 * A VNode is a node in the Neo4j graph that follows certain rules:
 *   - Every VNode is uniquely identified by a UUID
 *   - Every VNode optionally has a "shortId" string key; the shortId can be changed but previously used shortIds
 *     continue to point to the same VNode.
 *   - VNodes can only be modified (mutated) via "Actions", which are recorded via an Action VNode in the graph.
 *   - Each VNode is an instance of one or more VNode types ("labels" in Neo4j), which enforce a strict schema of
 *     properties and relationships
 *
 * This class is not exposed directly in the public API for Vertex Framework. Instead, use the VNodeType class declared
 * in layer 4.
 */
abstract class _BaseVNodeType {
    public constructor() { throw new Error("VNodeType should never be instantiated. Use it statically only."); }
    // static label: string;
    static readonly properties: PropSchemaWithUuid = {uuid: UuidProperty};
    /** Relationships allowed/available _from_ this VNode type to other VNodes */
    static readonly rel: {[K: string]: VNodeRelationship} = emptyObj;
    /** When pull()ing data of this type, what field should it be sorted by? e.g. "name" or "name DESC" */
    static readonly defaultOrderBy: string|undefined = undefined;

    static async validate(dbObject: RawVNode<any>, tx: WrappedTransaction): Promise<void> {
        // Note: tests for this function are in layer3/relationship-validation.test.ts since they depend on actions

        // Validate properties:
        const validation = await Joi.object(this.properties).keys({
            _identity: Joi.number(),
            _labels: Joi.any(),
        }).validateAsync(dbObject, {allowUnknown: true});  // We must allow unknown so that parent classes can validate, without knowledge of their child class schemas
        if (validation.error) {
            throw validation.error;
        }

        // Validate relationships:
        const relTypes = Object.keys(this.rel);
        if (relTypes.length > 0) {
            // Storing large amounts of data on relationship properties is not recommended so it should be safe to pull
            // down all the relationships and their properties.
            const relData = await tx.query(C`
                MATCH (node:VNode) WHERE id(node) = ${dbObject._identity}
                MATCH (node)-[rel]->(target:VNode)
                RETURN type(rel) as relType, properties(rel) as relProps, labels(target) as targetLabels, id(target) as targetId
            `.givesShape({relType: "string", relProps: "any", targetLabels: {list: "string"}, targetId: "number"}));
            // Check each relationship type, one type at a time:
            for (const relType of relTypes) {
                const spec = this.rel[relType];
                const rels = relData.filter(r => r.relType === relType);
                // Check the target labels, if they are restricted:
                if (spec.to !== undefined) {
                    const labelsPresent = new Set<string>();
                    rels.forEach(r => r.targetLabels.forEach(label => labelsPresent.add(label)));
                    spec.to.forEach(allowedNodeType => {
                        getAllLabels(allowedNodeType).forEach(label => labelsPresent.delete(label))
                    });
                    // Any remaining labels in labelsPresent are not allowed:
                    labelsPresent.forEach(badLabel => { throw new ValidationError(`Relationship ${relType} is not allowed to point to node with label ${badLabel}`); });
                }
                // Check the cardinality of this relationship type, if restricted:
                if (spec.cardinality !== Cardinality.ToMany) {
                    // How many nodes does this relationship type point to:
                    const targetCount = rels.length;
                    if (spec.cardinality === Cardinality.ToOneRequired) {
                        if (targetCount < 1) {
                            throw new ValidationError(`Required relationship type ${relType} must point to one node, but does not exist.`);
                        } else if (targetCount > 1) {
                            throw new ValidationError(`Required to-one relationship type ${relType} is pointing to more than one node.`);
                        }
                    } else if (spec.cardinality === Cardinality.ToOneOrNone) {
                        if (targetCount > 1) {
                            throw new ValidationError(`To-one relationship type ${relType} is pointing to more than one node.`);
                        }
                    } else if (spec.cardinality === Cardinality.ToManyUnique) {
                        const uniqueTargets = new Set(rels.map(r => r.targetId));
                        if (uniqueTargets.size !== targetCount) {
                            throw new ValidationError(`Creating multiple ${relType} relationships between the same pair of nodes is not allowed.`);
                        }
                    }
                }
                // Check the properties, if their schema is specified:
                if (Object.keys(spec.properties).length) {
                    rels.forEach(r => {
                        const valResult = Joi.object(spec.properties).validate(r.relProps);
                        if (valResult.error) {
                            throw valResult.error;
                        }
                    });
                }
            }
        }
    }

    /**
     * Helper method used to declare relationships with correct typing. Do not override this.
     * Usage:
     *     static readonly rel = MyVNodeType.hasRelationshipsFromThisTo({
     *         ...
     *     }, ParentClassIfAny);
     */
    static hasRelationshipsFromThisTo<Rels extends VNodeRelationshipsData, ParentType extends BaseVNodeType|undefined>(relationshipDetails: Rels, parentType?: ParentType): VNodeRelationshipsFor<Rels>&(ParentType extends _BaseVNodeType ? ParentType["rel"] : unknown) {
        const result: {[K in keyof Rels]: VNodeRelationship} = {...parentType?.rel} as any;
        for (const relName in relationshipDetails) {
            result[relName] = new VNodeRelationship(relName, relationshipDetails[relName]);
        }
        return Object.freeze(result) as any;
    }

    // This method is not used for anything, but without at least one non-static method, TypeScript allows this:
    //     const test: _BaseVNodeType = "some string which is not a VNodeType!";
    protected __vnode(): void {/* */}
    protected static __vnode(): void {/* */}
}

// This little trick (and the VNodeType interface below) are required so that this class is only used statically,
// never instantiated.
export const BaseVNodeType = _BaseVNodeType;

export interface BaseVNodeType {
    new(): _BaseVNodeType;
    readonly label: string;
    readonly properties: PropSchemaWithUuid;
    /** Relationships allowed/available _from_ this VNode type to other VNodes */
    readonly rel: {[RelName: string]: VNodeRelationship};
    readonly defaultOrderBy: string|undefined;
    validate(dbObject: RawVNode<any>, tx: WrappedTransaction): Promise<void>;

    hasRelationshipsFromThisTo<Rels extends VNodeRelationshipsData>(relationshipDetails: Rels): VNodeRelationshipsFor<Rels>;
}

/** Helper function to check if some object is a VNodeType */
export function isBaseVNodeType(obj: any): obj is BaseVNodeType {
    return Object.prototype.isPrototypeOf.call(_BaseVNodeType, obj);
}

/**
 * Properties Schema, defined using Joi validators.
 * 
 * This represents a generic schema, used to define the properties allowed/expected on a graph node, relationship, etc.
 */
export interface PropSchema {
    [K: string]: Joi.AnySchema
}

/**
 * A property schema that includes a UUID. All VNodes in the graph have a UUID so comply with this schema.
 */
interface PropSchemaWithUuid {
    uuid: Joi.StringSchema;
    [K: string]: Joi.AnySchema;
}

export type PropertyDataType<Props extends PropSchema, propName extends keyof Props> = (
    propName extends "uuid" ? UUID :
    Props[propName] extends Joi.StringSchema ? string :
    Props[propName] extends Joi.NumberSchema ? number :
    Props[propName] extends Joi.BooleanSchema ? boolean :
    Props[propName] extends Joi.DateSchema ? string :
    any
);

/**
 * If a single VNode is loaded from the database (without relationships or virtual properties), this is the shape
 * of the resulting data.
 */
export type RawVNode<T extends BaseVNodeType> = {
    [K in keyof T["properties"]]: PropertyDataType<T["properties"], K>;
} & { _identity: number; _labels: string[]; };


interface VNodeRelationshipsData {
    [RelName: string]: VNodeRelationshipData;
}
enum Cardinality {
    /** This relationship points to a single target node and it must be present. */
    ToOneRequired = ":1",
    /** This relationship points to a single target node if it exists, but the relationship may not exist. */
    ToOneOrNone = ":0-1",
    /**
     * ToMany: This relationshipship can point to any number of nodes, including to the same node multiple times.
     * This is the default, which is the same as having no restrictions on cardinality.
     */
    ToMany = ":*",
    /** This relationship can point to many nodes, but cannot point to the same node multiple times */
    ToManyUnique = ":*u",
}
/** Parameters used when defining a VNode; this simpler data is used to construct more complete VNodeRelationship objects */
interface VNodeRelationshipData {
    /**
     * This relationship is allowed to point _to_ VNodes of these types.
     * Omit if it can point to any VNode.
     */
    to?: ReadonlyArray<_BaseVNodeType>;  // For some reason ReadonlyArray<VNodeType> doesn't work
    /** The properties that are expected/allowed on this relationship */
    properties?: Readonly<PropSchema>;
    /** Cardinality: set restrictions on how many nodes this relationship can point to. */
    cardinality?: Cardinality,
}

/**
 * Defines a relationship that is allowed between a VNodeType and other VNodes in the graph
 */
export class VNodeRelationship<PS extends PropSchema = PropSchema> {
    readonly label: string;  // e.g. IS_FRIEND_OF
    readonly #data: Readonly<VNodeRelationshipData>;
    static readonly Cardinality = Cardinality;

    constructor(label: string, initData: VNodeRelationshipData) {
        this.label = label;
        this.#data = initData;
    }
    get to(): ReadonlyArray<BaseVNodeType>|undefined { return this.#data.to as ReadonlyArray<BaseVNodeType>|undefined; }
    get properties(): Readonly<PS> { return this.#data.properties || emptyObj as any; }
    get cardinality(): Cardinality { return this.#data.cardinality || Cardinality.ToMany; }
}

// Internal helper to get a typed result when converting from a map of VNodeRelationshipData entries to VNodeRelationship entries
type VNodeRelationshipsFor<Rels extends VNodeRelationshipsData> = {
    [K in keyof Rels]: VNodeRelationship<Rels[K]["properties"] extends PropSchema ? Rels[K]["properties"] : PropSchema>
};

const registeredNodeTypes: {[label: string]: BaseVNodeType} = {};

export function registerVNodeType(vnt: BaseVNodeType): void {
    if (registeredNodeTypes[vnt.label] !== undefined) {
        throw new Error(`Duplicate VNodeType label: ${vnt.label}`);
    }
    if (vnt.properties.uuid !== UuidProperty) {
        throw new Error(`${vnt.name} VNodeType does not inherit the required uuid property from the base class.`);
    }
    if ("shortId" in vnt.properties && vnt.properties.shortId !== ShortIdProperty) {
        throw new Error(`If a VNode declares a shortId property, it must use the global ShortIdProperty definition.`);
    }
    // Check for annoying circular references that TypeScript can't catch:
    Object.values(vnt.rel).forEach(rel => {
        if (rel.to) {
            rel.to.forEach((targetVNT, idx) => {
                if (targetVNT === undefined) {
                    throw new Error(`Circular reference in ${vnt.name} definition: relationship ${rel.label}.to[${idx}] is undefined.`);
                }
            });
        }
    });
    registeredNodeTypes[vnt.label] = vnt;
}

/** Only to be used for tests. Undoes a call to registerVNodeType() */
export function unregisterVNodeType(vnt: BaseVNodeType): void {
    delete registeredNodeTypes[vnt.label];
}

/** Exception: A VNode with the specified label has not been registered [via registerVNodeType()]  */
export class InvalidNodeLabel extends Error {}

/** Given a label used in the Neo4j graph (e.g. "User"), get its VNodeType definition */
export function getVNodeType(label: string): BaseVNodeType {
    const def = registeredNodeTypes[label];
    if (def === undefined) {
        throw new InvalidNodeLabel(`VNode definition with label ${label} has not been loaded.`);
    }
    return def;
}

export function getAllLabels(vnt: BaseVNodeType): string[] {
    if (!vnt.label || vnt.label === "VNode") {
        throw new Error(`VNodeType ${vnt} has no valid label.`);
    }
    const labels = [];
    for (let t = vnt; t.label; t = Object.getPrototypeOf(t)) {
        labels.push(t.label);
    }
    labels.push("VNode");
    return labels;
}

/**
 * A consistency check failure when validating our graph's data.
 * 
 * Use PublicValidationError if the message is safe for end users to see
 * (contains no internal/private data).
 */
export class ValidationError extends Error {}
// /** A validation error that is safe to report publicly. */
export class PublicValidationError extends ValidationError {}

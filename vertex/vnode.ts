import * as Joi from "@hapi/joi";
import { Transaction } from "neo4j-driver";
import { CypherQuery } from "./cypher-sugar";
import { UUID } from "./lib/uuid";

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


/**
 * Abstract base class for a "VNode".
 * A VNode is a node in the Neo4j graph that follows certain rules:
 *   - Every VNode is uniquely identified by a UUID
 *   - Every VNode optionally has a "shortId" string key; the shortId can be changed but previously used shortIds
 *     continue to point to the same VNode.
 *   - VNodes can only be modified (mutated) via "Actions", which are recorded via an Action VNode in the graph.
 *   - Each VNode is an instance of one or more VNode types ("labels" in Neo4j), which enforce a strict schema of
 *     properties and relationships
 */
abstract class _VNodeType {
    public constructor() { throw new Error("VNodeType should never be instantiated. Use it statically only."); }
    // static label: string;
    static readonly properties: PropSchemaWithUuid = {uuid: UuidProperty};
    static readonly relationshipsFrom: RelationshipsFromSchema = {};
    static readonly virtualProperties: VirtualPropsSchema = {};
    /** When pull()ing data of this type, what field should it be sorted by? e.g. "name" or "name DESC" */
    static readonly defaultOrderBy: string|undefined = undefined;

    static async validate(dbObject: RawVNode<any>, tx: Transaction): Promise<void> {
        const validation = await Joi.object(this.properties).keys({
            _identity: Joi.number(),
            _labels: Joi.any(),
        }).validateAsync(dbObject, {allowUnknown: false});
        if (validation.error) {
            throw validation.error;
        }
    }
}

// This little trick (and the VNodeType interface below) are required so that this class is only used statically,
// never instantiated.
export const VNodeType = _VNodeType;

export interface VNodeType {
    new(): _VNodeType;
    readonly label: string;
    readonly properties: PropSchemaWithUuid;
    readonly relationshipsFrom: RelationshipsFromSchema;
    readonly virtualProperties: VirtualPropsSchema;
    readonly defaultOrderBy: string|undefined;
    validate(dbObject: RawVNode<any>, tx: Transaction): Promise<void>;
}

/** Helper function to check if some object is a VNodeType */
export function isVNodeType(obj: any): obj is VNodeType {
    return Object.prototype.isPrototypeOf.call(_VNodeType, obj);
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
export type RawVNode<T extends VNodeType> = {
    [K in keyof T["properties"]]: PropertyDataType<T["properties"], K>;
} & { _identity: number; _labels: string[]; };

/**
 * Define an allowed relationship from a VNode to other nodes in the graph.
 */
interface RelationshipDefinition {
    /** The labels (VNode types) that this relationship goes _to_ */
    toLabels: string[];
    /** The properties that are expected/allowed on this relationship */
    properties: PropSchema;
}
/**
 * Define the allowed relationships from a VNode to other nodes in the graph.
 */
type RelationshipsFromSchema = { [K: string]: RelationshipDefinition };

/**
 * Every VNode can declare "virtual properties" which are computed properties
 * (such as related VNodes) that can be loaded from the graph or other sources.
 * For example, a "User" node could have "age" (now() - dateOfBirth) or "friends"
 * (list of related User nodes) as virtual properties.
 */
export interface VirtualPropsSchema {
    [K: string]: VirtualPropertyDefinition,
}

export const VirtualPropType = {
    // What type of virtual property this is. Note this can't be a const enum, because doing so breaks useful type
    // inference unless it's always explicitly used as "VirtualPropType.ManyRelationship as const", which is annoying.
    ManyRelationship: "many-relationship" as const,
    OneRelationship: "one-relationship" as const,
}

export interface VirtualManyRelationshipProperty {
    type: typeof VirtualPropType.ManyRelationship;
    query: CypherQuery;
    target: VNodeType;
    // One of the relationships in the query can be assigned to the variable @rel, and if so, specify its props here so
    // that the relationship properties can be optionally included (as part of the target node)
    relationshipProps?: PropSchema,
}
export interface VirtualOneRelationshipProperty {
    type: typeof VirtualPropType.OneRelationship,
    query: CypherQuery,
    target: VNodeType;
}

export type VirtualPropertyDefinition = (
    VirtualManyRelationshipProperty|
    VirtualOneRelationshipProperty
);

const registeredNodeTypes: {[label: string]: VNodeType} = {};

export function registerVNodeType(tnt: VNodeType): void {
    if (registeredNodeTypes[tnt.label] !== undefined) {
        throw new Error(`Duplicate VNodeType label: ${tnt.label}`);
    }
    if (tnt.properties.uuid !== UuidProperty) {
        throw new Error(`${tnt.name} VNodeType does not inherit the required uuid property from the base class.`);
    }
    if ("shortId" in tnt.properties && tnt.properties.shortId !== ShortIdProperty) {
        throw new Error(`If a VNode declares a shortId property, it must use the global ShortIdProperty definition.`);
    }
    registeredNodeTypes[tnt.label] = tnt;
}

/** Exception: A VNode with the specified label has not been registered [via registerVNodeType()]  */
export class InvalidNodeLabel extends Error {}

/** Given a label used in the Neo4j graph (e.g. "User"), get its VNodeType definition */
export function getVNodeType(label: string): VNodeType {
    const def = registeredNodeTypes[label];
    if (def === undefined) {
        throw new InvalidNodeLabel(`VNode definition with label ${label} has not been loaded.`);
    }
    return def;
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

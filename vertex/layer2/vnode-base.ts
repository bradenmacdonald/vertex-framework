import * as Joi from "@hapi/joi";
import { UUID } from "../lib/uuid";
import { WrappedTransaction } from "../transaction";

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
        const validation = await Joi.object(this.properties).keys({
            _identity: Joi.number(),
            _labels: Joi.any(),
        }).validateAsync(dbObject, {allowUnknown: false});
        if (validation.error) {
            throw validation.error;
        }
    }

    /**
     * Helper method used to declare relationships with correct typing. Do not override this.
     * Usage:
     *     static readonly rel = MyVNodeType.hasRelationshipsFromThisTo({
     *         ...
     *     });
     */
    static hasRelationshipsFromThisTo<Rels extends VNodeRelationshipsData>(relationshipDetails: Rels): VNodeRelationshipsFor<Rels> {
        const result: {[K in keyof Rels]: VNodeRelationship} = {} as any;
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
/** Parameters used when defining a VNode; this simpler data is used to construct more complete VNodeRelationship objects */
interface VNodeRelationshipData {
    /**
     * This relationship is allowed to point _to_ VNodes of these types.
     * Omit if it can point to any VNode.
     */
    to?: ReadonlyArray<_BaseVNodeType>;  // For some reason ReadonlyArray<VNodeType> doesn't work
    /** The properties that are expected/allowed on this relationship */
    properties?: Readonly<PropSchema>;
}

/**
 * Defines a relationship that is allowed between a VNodeType and other VNodes in the graph
 */
export class VNodeRelationship<PS extends PropSchema = PropSchema> {
    readonly label: string;  // e.g. IS_FRIEND_OF
    readonly #data: Readonly<VNodeRelationshipData>;

    constructor(label: string, initData: VNodeRelationshipData) {
        this.label = label;
        this.#data = initData;
    }
    get to(): ReadonlyArray<BaseVNodeType>|undefined { return this.#data.to as ReadonlyArray<BaseVNodeType>|undefined; }
    get properties(): Readonly<PS> { return this.#data.properties || emptyObj as any; }
}

// Internal helper to get a typed result when converting from a map of VNodeRelationshipData entries to VNodeRelationship entries
type VNodeRelationshipsFor<Rels extends VNodeRelationshipsData> = {
    [K in keyof Rels]: VNodeRelationship<Rels[K]["properties"] extends PropSchema ? Rels[K]["properties"] : PropSchema>
};

const registeredNodeTypes: {[label: string]: BaseVNodeType} = {};

export function registerVNodeType(tnt: BaseVNodeType): void {
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
export function getVNodeType(label: string): BaseVNodeType {
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

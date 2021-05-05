import * as Joi from "@hapi/joi";
import { UUID } from "../lib/uuid";
import { VNID, isVNID } from "../lib/vnid";
import { WrappedTransaction } from "../transaction";
import { C } from "./cypher-sugar";

/** Strict VNID Validator for Joi */
const vnidValidator: Joi.CustomValidator = (stringValue, helpers) => {
    if (!isVNID(stringValue)) {
        throw new Error("Invalid VNID");
    }
    return stringValue;
};

// Every VNode is uniquely and permanently identified by a VNID
export const VNIDProperty = Joi.string().custom(vnidValidator);
// Some VNodeTypes also use a "slug ID", which can be changed
export const SlugIdProperty = Joi.string().regex(/^[-\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]+$/u).required();
// An empty object that can be used as a default value for read-only properties
export const emptyObj = Object.freeze({});
// A private key used to store relationship types (labels) on their declarations
const relTypeKey = Symbol("relTypeKey");


export interface RelationshipsSchema {
    [RelName: string]: RelationshipDeclaration;
}
/** Interface used to declare each relationship that can come *from* this VNodeType to other VNodes */
export interface RelationshipDeclaration {
    /**
     * This relationship is allowed to point _to_ VNodes of these types.
     * Use [VNodeType] itself to mean "Any VNodeType"
     */
    to: ReadonlyArray<{new(): _BaseVNodeType;label: string}>; // Would prefer to use ReadonlyArray<BaseVNodeType>, but it causes circular type issues when used with the hasRelationshipsFromThisTo helper function
    /** The properties that are expected/allowed on this relationship */
    properties?: Readonly<PropSchema>;
    /** Cardinality: set restrictions on how many nodes this relationship can point to. */
    cardinality?: Cardinality,
    // A private key used to store relationship types (labels) on their declarations. Set by the @VNode.declare decorator.
    [relTypeKey]?: string;
}
export enum Cardinality {
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

/**
 * Base class for a "VNode".
 * A VNode is a node in the Neo4j graph that follows certain rules:
 *   - Every VNode is uniquely identified by a VNID
 *   - Every VNode optionally has a "slugId" string key; the slugId can be changed but previously used slugIds
 *     continue to point to the same VNode.
 *   - VNodes can only be modified (mutated) via "Actions", which are recorded via an Action VNode in the graph.
 *   - Each VNode is an instance of one or more VNode types ("labels" in Neo4j), which enforce a strict schema of
 *     properties and relationships
 *
 * This class is not exposed directly in the public API for Vertex Framework. Instead, use the VNodeType class declared
 * in layer 4.
 */
export class _BaseVNodeType {
    public constructor() { throw new Error("VNodeType should never be instantiated. Use it statically only."); }
    static label = "VNode";
    /** If this type has a slugId property, this is the prefix that all of its slugIds must have (e.g. "user-") */
    static readonly slugIdPrefix: string = "";
    static readonly properties: PropSchemaWithVNID = {id: VNIDProperty};
    /** Relationships allowed/available _from_ this VNode type to other VNodes */
    static readonly rel: RelationshipsSchema = emptyObj;
    /** When pull()ing data of this type, what field should it be sorted by? e.g. "name" or "name DESC" */
    static readonly defaultOrderBy: string|undefined = undefined;

    static async validate(dbObject: RawVNode<any>, tx: WrappedTransaction): Promise<void> {
        // Note: tests for this function are in layer3/validation.test.ts since they depend on actions

        // Validate slugId prefix
        if (this.slugIdPrefix !== "") {
            if (!this.properties.slugId) {
                throw new Error("A VNodeType cannot specify a slugIdPrefix if it doesn't declare the slugId property");
            }
            if (!dbObject.slugId.startsWith(this.slugIdPrefix)) {
                throw new ValidationError(`${this.label} has an invalid slugId "${dbObject.slugId}". Expected it to start with "${this.slugIdPrefix}".`);
            }
        }

        // Validate properties:
        const validation = await Joi.object(this.properties).keys({
            _identity: Joi.number(),
            _labels: Joi.any(),
        }).validateAsync(dbObject, {abortEarly: false, allowUnknown: true});  // We must allow unknown so that parent classes can validate, without knowledge of their child class schemas
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
                    // Every node that this relationship points to must have at least one of the allowed labels
                    // This should work correctly with inheritance
                    const allowedLabels = spec.to.map(vnt => vnt.label);
                    rels.forEach(r => {
                        if (!allowedLabels.find(allowedLabel => r.targetLabels.includes(allowedLabel))) {
                            throw new ValidationError(`Relationship ${relType} is not allowed to point to node with labels :${r.targetLabels.join(":")}`);
                        }
                    });
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
                if (Object.keys(spec.properties ?? emptyObj).length) {
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
     * Validate and register a VNodeType.
     *
     * Every VNodeType must be decorated with this function (or call this function with the VNodeType subclass, if not
     * using decorators)
     * 
     * This is protected because a public version is declared in the VNodeType class that subclasses this one.
     */
    protected static declare(vnt: BaseVNodeType): void {

        if (vnt.properties.id !== VNIDProperty) {
            throw new Error(`${vnt.name} VNodeType does not inherit the required id property from the base class.`);
        }

        if ("slugId" in vnt.properties && vnt.properties.slugId !== SlugIdProperty) {
            throw new Error(`If a VNode declares a slugId property, it must use the global SlugIdProperty definition.`);
        }

        // Check for annoying circular references that TypeScript can't catch:
        Object.entries(vnt.rel).forEach(([relName, rel]) => {
            rel.to.forEach((targetVNT, idx) => {
                if (targetVNT === undefined) {
                    throw new Error(`Circular reference in ${vnt.name} definition: relationship ${vnt.name}.rel.${relName}.to[${idx}] is undefined.`);
                }
            });
        });

        // Store the "type" (name/label) of each relationship in its definition, so that when parts of the code
        // reference a relationship like SomeVNT.rel.FOO_BAR, we can get the name "FOO_BAR" from that value, even though
        // the name was only declared as the key, and is not part of the FOO_BAR value.
        for (const relationshipType of Object.keys(vnt.rel)) {
            const relDeclaration = vnt.rel[relationshipType];
            if (relDeclaration[relTypeKey] !== undefined && relDeclaration[relTypeKey] != relationshipType) {
                // This is a very obscure edge case error, but if someone is saying something like
                // rel = { FOO: SomeOtherVNodeType.rel.BAR } then we need to flag that we can't share the same
                // relationship declaration and call it both FOO and BAR.
                throw new Error(`The relationship ${vnt.name}.${relationshipType} is also declared somewhere else as type ${relDeclaration[relTypeKey]}.`);
            }
            relDeclaration[relTypeKey] = relationshipType;
        }

        // Freeze, register, and return the VNodeType:
        //vnt = Object.freeze(vnt);
        registerVNodeType(vnt);
    }

    // This method is not used for anything, but without at least one non-static method, TypeScript allows this:
    //     const test: _BaseVNodeType = "some string which is not a VNodeType!";
    protected __vnode(): void {/* */}
    protected static __vnode(): void {/* */}

    // Helpers for declaring relationships:
    static readonly Rel = Cardinality;
}

// This little trick (and the VNodeType interface below) are required so that this class is only used statically,
// never instantiated.
export const BaseVNodeType = _BaseVNodeType;

export interface BaseVNodeType {
    new(): _BaseVNodeType;
    readonly label: string;
    readonly properties: PropSchemaWithVNID;
    /** Relationships allowed/available _from_ this VNode type to other VNodes */
    readonly rel: RelationshipsSchema;
    readonly defaultOrderBy: string|undefined;
    validate(dbObject: RawVNode<any>, tx: WrappedTransaction): Promise<void>;

    declare(vnt: BaseVNodeType): void;
}

/** Helper function to check if some object is a VNodeType */
export function isBaseVNodeType(obj: any): obj is BaseVNodeType {
    return Object.prototype.isPrototypeOf.call(_BaseVNodeType, obj);
}

/** Helper function to get the type/name of a relationship from its declaration - see _BaseVNodeType.declare() */
export function getRelationshipType(rel: RelationshipDeclaration): string {
    const relDeclaration = rel as any;
    if (relDeclaration[relTypeKey] === undefined) {
        throw new Error(`Tried accessing a relationship on a VNodeType that didn't use the @VNodeType.declare class decorator`);
    }
    return relDeclaration[relTypeKey];
}
/**
 * Is the thing passed as a parameter a relationship declaration (that was declared in a VNode's "rel" static prop?)
 * This checks for a private property that gets added to every relationship by the @VNodeType.declare decorator.
 */
export function isRelationshipDeclaration(relDeclaration: RelationshipDeclaration): relDeclaration is RelationshipDeclaration {
    // In JavaScript, typeof null === "object" which is why we need the middle condition here.
    return typeof relDeclaration === "object" && relDeclaration !== null && relDeclaration[relTypeKey] !== undefined;
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
 * A property schema that includes a VNID. All VNodes in the graph have a VNID so comply with this schema.
 */
interface PropSchemaWithVNID {
    id: Joi.StringSchema;
    [K: string]: Joi.AnySchema;
}

export type PropertyDataType<Props extends PropSchema, propName extends keyof Props> = (
    propName extends "id" ? VNID :
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


const registeredNodeTypes: {[label: string]: BaseVNodeType} = {};

function registerVNodeType(vnt: BaseVNodeType): void {
    if (registeredNodeTypes[vnt.label] !== undefined) {
        throw new Error(`Duplicate VNodeType label: ${vnt.label}`);
    }
    registeredNodeTypes[vnt.label] = vnt;
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
        throw new Error(`VNodeType ${vnt.name} has no valid label.`);
    }
    const labels = [];
    for (let t = vnt; t.label; t = Object.getPrototypeOf(t)) {
        labels.push(t.label);
        if (t.label === "VNode") {
            break;
        }
    }
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

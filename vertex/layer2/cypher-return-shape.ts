import { Neo4j } from "../deps.ts";
import {
    FieldType,
    GetDataType,
    ResponseSchema,
    GetDataShape,
    Node,
    TypedField,
    CompositeTypedField,
} from "../lib/types/field.ts";
import { VDate } from "../lib/types/vdate.ts";
import type { BaseVNodeType, RawVNode } from "./vnode-base.ts";

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Conversion methods:
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Convert a single field in a transaction response (from the native Neo4j driver) to a typed variable
export function convertNeo4jFieldValue<FD extends TypedField>(fieldName: string, fieldValue: any, fieldDeclaration: FD): GetDataType<FD> {
    if (fieldValue === null) {
        return null as any;
    }
    switch (fieldDeclaration.type) {
        ////////////////////////////////////////////////
        // Basic property types
        case FieldType.Int: {
            // fieldValue is a BigInt but we're going to return it as a Number.
            if (fieldValue > BigInt(Number.MAX_SAFE_INTEGER) || fieldValue < BigInt(Number.MIN_SAFE_INTEGER)) {
                throw new Error("Cannot load large number from Neo4j into Number type. Change field definition from Int to BigInt.");
            }
            return Number(fieldValue) as any;
        }
        case FieldType.BigInt: { return fieldValue; }  // Already a bigint, since we have Neo4j configured to use BigInt by default
        case FieldType.Float: { return Number(fieldValue) as any; }
        case FieldType.Date: { return VDate.fromNeo4jDate(fieldValue) as any; }
        case FieldType.DateTime: {
            // Convert from the Neo4j "DateTime" class to a standard JavaScript Date object:
            return new Date(fieldValue.toString()) as any;
        }
        case FieldType.Boolean:
        case FieldType.String:
        case FieldType.VNID:
        case FieldType.Slug: {
            return fieldValue;
        }
        ////////////////////////////////////////////////
        // Composite field types
        case FieldType.Record: {
            const schema = (fieldDeclaration as any as CompositeTypedField).schema;
            const map: any = {}
            for (const mapKey in schema) {
                map[mapKey] = convertNeo4jFieldValue(mapKey, fieldValue[mapKey] ?? null, schema[mapKey]);
            }
            return map;
        }
        case FieldType.Map: {
            const schema = (fieldDeclaration as any as CompositeTypedField).schema;
            const map: any = {}
            for (const mapKey in fieldValue) {
                map[mapKey] = convertNeo4jFieldValue(mapKey, fieldValue[mapKey], schema);
            }
            return map;
        }
        case FieldType.List: {
            const schema = (fieldDeclaration as any as CompositeTypedField).schema;
            return fieldValue.map((listValue: any) => convertNeo4jFieldValue(fieldName, listValue, schema));
        }
        ////////////////////////////////////////////////
        // Response field types
        case FieldType.VNode: {
            const vnodeType = (fieldDeclaration as any).vnodeType;
            return neoNodeToRawVNode(fieldValue, vnodeType, fieldName) as any;
        }
        case FieldType.Node:
        case FieldType.Path:
        case FieldType.Relationship:
        case FieldType.Any:
            return fieldValue;  // Return the raw result, completely unmodified
        default: {
            throw new Error(`Unexpected field declaration type: ${fieldDeclaration.type}`);
        }
    }
}

// Convert a transaction response (from the native Neo4j driver) to a TypedResult
export function convertNeo4jRecord<RS extends ResponseSchema>(record: Neo4j.Record, returnShape: RS): GetDataShape<RS> {
    const newRecord: any = {};
    for (const fieldName of Object.keys(returnShape)) {
        const fieldValue = record.get(fieldName);
        const fieldDeclaration = returnShape[fieldName];
        newRecord[fieldName] = convertNeo4jFieldValue(fieldName, fieldValue, fieldDeclaration);
    }
    return newRecord;
}

export function neoNodeToRawVNode<VNT extends BaseVNodeType = any>(fieldValue: Node, vnodeType: VNT, fieldName: string): RawVNode<VNT> {
    if (!(fieldValue as any).__isNode__) { // would be nice if isNode() were exported from neo4j-driver
        throw new Error(`Field ${fieldName} is of type ${typeof fieldValue}, not a VNode.`);
    }
    if (fieldValue.labels.includes("DeletedVNode")) {
        throw new Error(`Field ${fieldName} matched a deleted VNode - check your query and match only nodes with the :VNode label`);
    }
    if (!fieldValue.labels.includes("VNode")) {
        throw new Error(`Field ${fieldName} is a node but is missing the VNode label`);
    }
    
    // "Clean" the properties.
    // Here we have to resolve a discrepancy: when requesting a specific property via pul() or a raw query that lists
    // specific properties to return, Neo4j will give them a NULL value when those specific named properties are absent.
    // But when just returning a Node in general, Neo4j will only return defined properties and JavaScript will see any
    // absent properties as having an 'undefined' value - not NULL.
    // We resolve this by explicitly defaulting any expected properties to NULL if they are undefined at this point.
    const properties: any = {};
    for (const [propName, propSchema] of Object.entries(vnodeType.properties)) {
        if (propName in fieldValue.properties) {
            properties[propName] = convertNeo4jFieldValue(propName, fieldValue.properties[propName], propSchema);
        } else {
            properties[propName] = null;
            // We could verify that propSchema.nullable === true here, but this function gets used within Create/Update
            // actions in a way that sometimes pulls in the Node before the object has been fully created, so that some
            // values are temporarily null but will be non-null by the time the action finishes.
        }
    }
    return {
        ...properties,
        _labels: fieldValue.labels,
    } as RawVNode<VNT>;
}

import { Record as Neo4jRecord } from "neo4j-driver-lite";
import {
    FieldData,
    FieldType,
    GetDataType,
    ResponseFieldType,
    ResponseFieldSpec,
    ResponseSchema,
    GetDataShape,
    ResponseField,
    RawVNodeField,
    MapField,
    ListField,
    Node,
 } from "./field";
import { VDate } from "../lib/vdate";
import type { BaseVNodeType, RawVNode } from "./vnode-base";

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Conversion methods:
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// We need these type checks to help TypeScript out, as it seems to have some trouble:
function isPropertyField(declaration: ResponseFieldSpec): declaration is FieldData<any, any, any> {
    return declaration.type >= 0 && declaration.type < FieldType._max;
}
function isResponseField(declaration: ResponseFieldSpec): declaration is ResponseField {
    return declaration.type >= ResponseFieldType.Node && declaration.type < ResponseFieldType._max;
}


// Convert a single field in a transaction response (from the native Neo4j driver) to a typed variable
export function convertNeo4jFieldValue<FD extends ResponseFieldSpec>(fieldName: string, fieldValue: any, fieldDeclaration: FD): GetDataType<FD> {
    if (fieldValue === null) {
        return null as any;
    }
    if (fieldDeclaration.type === ResponseFieldType.VNode) { // This is a node (VNode)
        return neoNodeToRawVNode(fieldValue, (fieldDeclaration as any).vnodeType, fieldName) as any;
    } else if (isPropertyField(fieldDeclaration)) {
        switch (fieldDeclaration.type) {
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
            default:
                return fieldValue;
        }
    } else if (isResponseField(fieldDeclaration)) {
        switch (fieldDeclaration.type) {
            case ResponseFieldType.Map: {
                const spec = (fieldDeclaration as any as MapField).spec;
                const map: any = {}
                for (const mapKey in spec) {
                    map[mapKey] = convertNeo4jFieldValue(mapKey, fieldValue[mapKey] ?? null, spec[mapKey]);
                }
                return map;
            }
            case ResponseFieldType.List: {
                const spec = (fieldDeclaration as any as ListField).spec;
                return fieldValue.map((listValue: any) => convertNeo4jFieldValue(fieldName, listValue, spec));
            }
            case ResponseFieldType.Node:
            case ResponseFieldType.Path:
            case ResponseFieldType.Relationship:
                return fieldValue;  // Return the raw result, completely unmodified
            default: { throw new Error(`Unexpected Response Field Type: ${fieldDeclaration.type}`); }
        }
    } else {
        throw new Error(`Unexpected field declaration type: ${fieldDeclaration}`);
    }
}

// Convert a transaction response (from the native Neo4j driver) to a TypedResult
export function convertNeo4jRecord<RS extends ResponseSchema>(record: Neo4jRecord, returnShape: RS): GetDataShape<RS> {
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

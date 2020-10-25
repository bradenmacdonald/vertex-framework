import { Node, Record as Neo4jRecord } from "neo4j-driver";
import { UUID } from "./lib/uuid";
import { VNodeType, isVNodeType, RawVNode } from "./vnode";

//// Specifying the return shape that is expected from a cypher query:
export type ReturnShape = {
    [fieldName: string]: FieldType,
};
// This helper function is used to declare variables with appropriate typing as "RS extends ReturnShape" and not just "ReturnShape"
export function ReturnShape<RS extends ReturnShape>(rs: RS): RS { return rs; }
type FieldType = (
    | VNodeType
    | MapReturnShape
    | ListReturnShape
    | "uuid"
    | "string"
    | "number"
    | "boolean"
    | "any"
);
type MapReturnShape = {map: ReturnShape};
type MapReturnShapeFull<MapShape extends ReturnShape> = {map: MapShape};
function isMapType(fieldType: FieldType): fieldType is MapReturnShape {
    return Object.keys(fieldType).length === 1 && (fieldType as any).map !== undefined;
}
type ListReturnShape = {list: FieldType};
type ListReturnShapeFull<ListValueType extends FieldType> = {list: ListValueType};
function isListType(fieldType: FieldType): fieldType is ListReturnShape {
    return Object.keys(fieldType).length === 1 && (fieldType as any).list !== undefined;
}

//// A fully-typed response for a given request:

export type TypedResult<RS extends ReturnShape> = {
    [key in keyof RS]: ReturnTypeFor<RS[key]>;
};
type ReturnTypeFor<DT extends FieldType> = (
    DT extends VNodeType ? RawVNode<DT> :
    DT extends MapReturnShapeFull<infer MapShape> ? TypedResult<MapShape> :
    // DT extends MapReturnShape ? any :
    DT extends ListReturnShapeFull<infer ListValueType> ? ReturnTypeFor<ListValueType>[] :
    // DT extends ListReturnShape ? any[] :
    DT extends "uuid" ? UUID :
    DT extends "string" ? string :
    DT extends "number" ? number :
    DT extends "boolean" ? boolean :
    DT extends "any" ? any :
    never
);

// Convert a single field in a transaction response (from the native Neo4j driver) to a typed variable
export function convertNeo4jFieldValue<FT extends FieldType>(fieldName: string, fieldValue: any, fieldType: FT): ReturnTypeFor<FT> {
    if (isVNodeType(fieldType)) { // This is a node (VNode)
        return neoNodeToRawVNode(fieldValue, fieldName) as any;
    } else if (isMapType(fieldType)) {
        return convertNeo4jRecord(fieldValue, fieldType.map) as any;
    } else if (isListType(fieldType)) {
        return fieldValue.map((listValue: any) => convertNeo4jFieldValue(fieldName, listValue, fieldType.list));
    } else {
        // This is some plain value like "MATCH (u:User) RETURN u.name"
        // e.g. newRecord["u.name"] = fieldValue
        return fieldValue;
    }
}

// Convert a transaction response (from the native Neo4j driver) to a TypedResult
export function convertNeo4jRecord<RS extends ReturnShape>(record: Neo4jRecord, returnShape: RS): TypedResult<RS> {
    const newRecord: any = {};
    for (const fieldName of Object.keys(returnShape)) {
        const fieldValue = record.get(fieldName);
        const fieldType: FieldType = returnShape[fieldName];
        newRecord[fieldName] = convertNeo4jFieldValue(fieldName, fieldValue, fieldType);
    }
    return newRecord;
}

function neoNodeToRawVNode<VNT extends VNodeType = any>(fieldValue: Node<any>, fieldName: string): RawVNode<VNT> {
    if (!(fieldValue as any).__isNode__) { // would be nice if isNode() were exported from neo4j-driver
        throw new Error(`Field ${fieldName} is of type ${typeof fieldValue}, not a VNode.`);
    }
    if (fieldValue.labels.includes("DeletedVNode")) {
        throw new Error(`Field ${fieldName} matched a deleted VNode - check your query and match only nodes with the :VNode label`);
    }
    if (!fieldValue.labels.includes("VNode")) {
        throw new Error(`Field ${fieldName} is a node but is missing the VNode label`);
    }
    return {
        ...fieldValue.properties,
        _identity: fieldValue.identity,
        _labels: fieldValue.labels,
    } as RawVNode<VNT>;
}

import { Node, Record as Neo4jRecord } from "neo4j-driver";
import { UUID } from "../lib/uuid";
import { VNID } from "../lib/vnid";
import { BaseVNodeType, isBaseVNodeType, RawVNode } from "./vnode-base";

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Specifying the return shape that is expected from a cypher query:
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type ReturnShape = {
    [fieldName: string]: FieldType,
};
// This helper function is used to declare variables with appropriate typing as "RS extends ReturnShape" and not just "ReturnShape"
export function ReturnShape<RS extends ReturnShape>(rs: RS): RS { return rs; }
export type FieldType = (
    | BaseVNodeType
    | MapReturnShape
    | ListReturnShape
    | NullableField
    | "uuid"
    | "vnid"
    | "string"
    | "number"
    | "boolean"
    | "any"
);
// FieldType for a map:
type MapReturnShape = {map: ReturnShape};
type MapReturnShapeFull<MapShape extends ReturnShape> = {map: MapShape};
function isMapType(fieldType: FieldType): fieldType is MapReturnShape {
    return Object.keys(fieldType).length === 1 && (fieldType as any).map !== undefined;
}
// FieldType for a list:
type ListReturnShape = {list: FieldType};
type ListReturnShapeFull<ListValueType extends FieldType> = {list: ListValueType};
function isListType(fieldType: FieldType): fieldType is ListReturnShape {
    return Object.keys(fieldType).length === 1 && (fieldType as any).list !== undefined;
}
// FieldType for a value that may be null:
type NullableField = {nullOr: FieldType};
type NullableFieldFull<NullableValueType extends FieldType> = {nullOr: NullableValueType};
function isNullableField(fieldType: FieldType): fieldType is NullableField {
    return Object.keys(fieldType).length === 1 && (fieldType as any).nullOr !== undefined;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// A fully-typed response for a given request:
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type TypedResult<RS extends ReturnShape> = {
    [key in keyof RS]: ReturnTypeFor<RS[key]>;
};
export type ReturnTypeFor<DT extends FieldType> = (
    DT extends BaseVNodeType ? RawVNode<DT> :
    DT extends MapReturnShapeFull<infer MapShape> ? TypedResult<MapShape> :
    DT extends ListReturnShapeFull<infer ListValueType> ? ReturnTypeFor<ListValueType>[] :
    // A nullable field is a little complex because we need to avoid an infinite type lookup in the case of {nullOr: {nullOr: ...}}
    DT extends NullableFieldFull<infer NullableValueType> ? null|(NullableValueType extends NullableField ? never : ReturnTypeFor<NullableValueType>) :
    DT extends "uuid" ? UUID :
    DT extends "vnid" ? VNID :
    DT extends "string" ? string :
    DT extends "number" ? number :
    DT extends "boolean" ? boolean :
    DT extends "any" ? any :
    never
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//// Conversion methods:
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Convert a single field in a transaction response (from the native Neo4j driver) to a typed variable
export function convertNeo4jFieldValue<FT extends FieldType>(fieldName: string, fieldValue: any, fieldType: FT): ReturnTypeFor<FT> {
    if (isBaseVNodeType(fieldType)) { // This is a node (VNode)
        return neoNodeToRawVNode(fieldValue, fieldName) as any;
    } else if (isMapType(fieldType)) {
        const map: any = {}
        for (const mapKey of Object.keys(fieldType.map)) {
            map[mapKey] = convertNeo4jFieldValue(mapKey, fieldValue[mapKey], fieldType.map[mapKey]);
        }
        return map;
    } else if (isListType(fieldType)) {
        return fieldValue.map((listValue: any) => convertNeo4jFieldValue(fieldName, listValue, fieldType.list));
    } else if (isNullableField(fieldType)) {
        return convertNeo4jFieldValue(fieldName, fieldValue, fieldType.nullOr);
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

export function neoNodeToRawVNode<VNT extends BaseVNodeType = any>(fieldValue: Node<any>, fieldName: string): RawVNode<VNT> {
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

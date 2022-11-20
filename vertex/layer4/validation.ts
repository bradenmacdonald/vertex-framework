import { convertNeo4jFieldValue } from "../layer2/cypher-return-shape.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { Cardinality, emptyObj, PropSchemaWithId, RawRelationships, RawVNode, ValidationError } from "../layer2/vnode-base.ts";
import { VNodeType } from "../layer3/vnode.ts";
import { validatePropSchema } from "../lib/types/field.ts";
import { WrappedTransaction } from "../transaction.ts";


/**
 * Validate that a VNode complies with the basic definition of its type (properties are of the right field type, etc.)
 * and "clean" property values based on their declarations. Also checks the cardinality of relationships.
 *
 * This is called automatically by the action runner anytime a VNode is modified.
 *
 * @param vnt 
 * @param dbObject 
 * @param tx 
 */
export async function baseValidateVNode(vnt: VNodeType, dbObject: RawVNode<VNodeType>, relationships: RawRelationships[], tx: WrappedTransaction): Promise<void> {

    // Validate slugId prefix
    if (vnt.slugIdPrefix !== "") {
        if (!(vnt.properties as PropSchemaWithId).slugId) {
            throw new Error("A VNodeType cannot specify a slugIdPrefix if it doesn't declare the slugId property");
        }
        if (typeof dbObject.slugId !== "string" || !dbObject.slugId.startsWith(vnt.slugIdPrefix)) {
            throw new ValidationError(`${vnt.label} has an invalid slugId "${dbObject.slugId}". Expected it to start with "${vnt.slugIdPrefix}".`);
        }
    }

    // Validate properties:
    const newValues: Record<string, unknown> = validatePropSchema(vnt.properties, dbObject);

    // Check if the validation cleaned/changed any of the values:
    const valuesChangedDuringValidation: Record<string, unknown> = {}
    for (const key in newValues) {
        if (newValues[key] !== dbObject[key]) {
            valuesChangedDuringValidation[key] = newValues[key];
        }
    }
    if (Object.keys(valuesChangedDuringValidation).length > 0) {
        await tx.queryOne(C`
            MATCH (node:VNode {id: ${dbObject.id}})
            SET node += ${valuesChangedDuringValidation}
        `.RETURN({}));
    }

    // Validate relationships:
    const relTypes = Object.keys(vnt.rel);
    if (relTypes.length > 0) {
        
        // Check each relationship type, one type at a time:
        for (const relType of relTypes) {
            const spec = vnt.rel[relType];
            const rels = relationships.filter(r => r.relType === relType);
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
                    if (spec.properties) {
                        // For consistency, we make missing properties always appear as "null" instead of "undefined":
                        const valuesFound = {...r.relProps};
                        for (const propName in spec.properties) {
                            if (propName in valuesFound) {
                                valuesFound[propName] = convertNeo4jFieldValue(propName, valuesFound[propName], spec.properties[propName]);
                            } else {
                                valuesFound[propName] = null;
                            }
                        }
                        validatePropSchema(spec.properties, valuesFound);
                    }
                });
            }
        }
    }
}

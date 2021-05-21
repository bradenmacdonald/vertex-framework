/**
 * A standard data request (BaseDataRequest) only allows specifying raw properties of a VNode.
 * These mixins extend the standard data request, so that one can request "virtual properties" (like related nodes),
 *  _conditionally_ request properties, and other things.
 *
 * This file contains the TypeScript types for the mixins, and a separate file contains their actual runtime
 * implementation, which is quite different. So the types in this file are a bit of a fake facade that provides a nice
 * developer experience and type checking in the IDE, but don't exactly match how things are implemented underneath.
 */

import { BaseVNodeType, RelationshipDeclaration } from "../layer2/vnode-base";
import { BaseDataRequest, AnyDataRequest, UpdateMixin, RequiredMixin } from "../layer3/data-request";
import { VirtualCypherExpressionProperty, VirtualManyRelationshipProperty, VirtualOneRelationshipProperty } from "./virtual-props";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";
import type { DerivedProperty } from "./derived-props";
import { TypedField } from "../lib/types/field";

///////////////// ConditionalRawPropsMixin /////////////////////////////////////////////////////////////////////////////

/** Allow requesting other raw/virtual/derived properties conditionally, based on whether or not a "flag" is set: */
export type ConditionalPropsMixin<
    VNT extends BaseVNodeType,
    conditionallyRequestedProperties extends AnyDataRequest<any>[] = [],
> = ({
    if:
        <ThisRequest extends AnyDataRequest<any>, SubSpec extends AnyDataRequest<any>>
            (this: ThisRequest, flagName: string, subRequest: (buildSubequest: BlankRequestSameMixins<ThisRequest, VNT>) => SubSpec) => (
                UpdateMixin<VNT, ThisRequest,
                    ConditionalPropsMixin<VNT, conditionallyRequestedProperties>,
                    ConditionalPropsMixin<VNT, [...conditionallyRequestedProperties, SubSpec]>
                >
            );
});

///////////////// VirtualPropsMixin ////////////////////////////////////////////////////////////////////////////////////

type VPTarget<VirtProp extends VirtualManyRelationshipProperty|VirtualOneRelationshipProperty> = (
    VirtProp["target"] extends BaseVNodeType ? VirtProp["target"] : never
);

/** Allow requesting virtual properties, optionally based on whether or not a flag is set */
export type VirtualPropsMixin<
    VNT extends VNodeTypeWithVirtualProps,
    includedVirtualProps extends RecursiveVirtualPropRequest<VNT>|unknown = unknown,
> = ({
    [propName in keyof VNT["virtualProperties"]]:
        VNT["virtualProperties"][propName] extends VirtualManyRelationshipProperty ?
            // For each x:many virtual property, add a method for requesting that virtual property:
            <ThisRequest extends AnyDataRequest<any>, SubSpec extends BaseDataRequest<VPTarget<VNT["virtualProperties"][propName]>, any, any>, FlagType extends string|undefined = undefined>
            // This is the method:
            (this: ThisRequest,
                subRequest: (buildSubrequest: BlankRequestSameMixins<ThisRequest, VPTarget<VNT["virtualProperties"][propName]> & ProjectRelationshipProps<VNT["virtualProperties"][propName]["relationship"]>>) => SubSpec,
            ) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {spec: SubSpec, type: "many"}
                    }>
                >
            )

        : VNT["virtualProperties"][propName] extends VirtualOneRelationshipProperty ?
            // For each x:one virtual property, add a method for requesting that virtual property:
            <ThisRequest extends AnyDataRequest<any>, SubSpec extends BaseDataRequest<VPTarget<VNT["virtualProperties"][propName]>, any, any>, FlagType extends string|undefined = undefined>
            (this: ThisRequest, subRequest: (buildSubequest: BlankRequestSameMixins<ThisRequest, VPTarget<VNT["virtualProperties"][propName]>>) => SubSpec) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {spec: SubSpec, type: "one"}
                    }>
                >
            )

        : VNT["virtualProperties"][propName] extends VirtualCypherExpressionProperty ?
            // Add a method to include this [virtual property based on a cypher expression], optionally toggled via a flag:
            <ThisRequest, FlagType extends string|undefined = undefined>
            (this: ThisRequest) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {type: "cypher", valueType: VNT["virtualProperties"][propName]["valueType"]}
                    }>
                >
            )
        : never
});

/** Type data about virtual properties that have been requested so far in a VNodeDataRequest */
type RecursiveVirtualPropRequest<VNT extends VNodeTypeWithVirtualProps> = {
    [K in keyof VNT["virtualProperties"]]?: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            IncludedVirtualManyProp<VNT["virtualProperties"][K], any> :
        VNT["virtualProperties"][K] extends VirtualOneRelationshipProperty ?
            IncludedVirtualOneProp<VNT["virtualProperties"][K], any> :
        VNT["virtualProperties"][K] extends VirtualCypherExpressionProperty ?
            IncludedVirtualCypherExpressionProp<VNT["virtualProperties"][K]["valueType"]> :
        never
    )
}

export interface IncludedVirtualManyProp<propType extends VirtualManyRelationshipProperty, Spec extends AnyDataRequest<VPTarget<propType>>> {
    spec: Spec,
    type: "many",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
}

export interface IncludedVirtualOneProp<propType extends VirtualOneRelationshipProperty, Spec extends AnyDataRequest<VPTarget<propType>>> {
    spec: Spec,
    type: "one",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
}

export interface IncludedVirtualCypherExpressionProp<FT extends TypedField> {
    type: "cypher",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
    valueType: FT;  // This field also doesn't exist, but is required for type inference to work
}

// When using a virtual property to join some other VNode to another node, this ProjectRelationshipProps type is used to
// "project" properties from the *relationship* so that they appear as virtual properties on the target VNode.
//
// For example, if there is a (:Person)-[:ACTED_IN]->(:Movie) where "Person" is the main VNode and "Person.movies" is a
// virtual property to list the movies they acted in, and the ACTED_IN relationship has a "role" property, then this is
// used to make the "role" property appear as a virtual property on the Movie VNode.
type ProjectRelationshipProps<Rel extends RelationshipDeclaration|undefined> = (
    Rel extends RelationshipDeclaration ? {
        virtualProperties: {
            [K in keyof Rel["properties"]]: (
                Rel["properties"][K] extends TypedField ?
                    VirtualCypherExpressionProperty<Rel["properties"][K]>
                : never
            )
        }
    } : unknown
);

///////////////// DerivedPropsMixin ////////////////////////////////////////////////////////////////////////////////////

/** Allow requesting derived properties, optionally based on whether or not a flag is set */
export type DerivedPropsMixin<
    VNT extends VNodeType,
    includedDerivedProps extends DerivedPropRequest<VNT>|unknown = unknown,
> = ({
    [propName in keyof VNT["derivedProperties"]]:
        // For each derived property, add a method for requesting that derived property:
        <ThisRequest>
        (this: ThisRequest) => (
            UpdateMixin<VNT, ThisRequest,
                DerivedPropsMixin<VNT, includedDerivedProps>,
                DerivedPropsMixin<VNT, includedDerivedProps & { [PN in propName]: {
                    valueType: GetDerivedPropValueType<
                        // VNT["derivedProperties"][propName] should be a DerivedProperty instance (due to VNodeType.declare()) but TypeScript doesn't know that.
                        VNT["derivedProperties"][propName] extends DerivedProperty<any> ? VNT["derivedProperties"][propName] : never
                    >,
                } }>
            >
        )
});

/** Type data about derived properties that have been requested so far in a VNodeDataRequest */
type DerivedPropRequest<VNT extends VNodeType> = {
    [K in keyof VNT["derivedProperties"]]?: IncludedDerivedPropRequest<any>;
}

export type IncludedDerivedPropRequest<ValueType> = {
    valueType: ValueType,
};

type GetDerivedPropValueType<DerivedProp extends DerivedProperty<any>> = (
    DerivedProp extends DerivedProperty<infer ValueType> ? ValueType : any
);

///////////////// ResetMixins //////////////////////////////////////////////////////////////////////////////////////////


// The mixin types contain type information about specific selected properties. When creating a recursive request for
// virtual properties (e.g. to select which fields to include for the target of one-to-many relationship), it's
// necessary to incude the same mixins, but with a different VNodeType specified and the data about which fields are
// included reset.
type BlankRequestSameMixins<Request extends BaseDataRequest<any, any, RequiredMixin>, newVNodeType extends BaseVNodeType> = (
    Request extends BaseDataRequest<any, any, RequiredMixin & infer Mixins> ? 
        BaseDataRequest<newVNodeType, never, (
            RequiredMixin &
            (Mixins extends ConditionalPropsMixin<infer Unused1, infer Unused2> ? ConditionalPropsMixin<newVNodeType> : unknown) &
            (Mixins extends VirtualPropsMixin<any, any> ?
                (newVNodeType extends VNodeTypeWithVirtualProps ? VirtualPropsMixin<newVNodeType> : unknown)
            : unknown) &
            (Mixins extends DerivedPropsMixin<any, any> ?
                (newVNodeType extends VNodeType ? DerivedPropsMixin<newVNodeType> : unknown)
            : unknown)
        )
    > : never
);


export type SubclassMixins<Request extends BaseDataRequest<any, any, RequiredMixin>, OldVNT extends VNodeType, NewVNT extends VNodeType> = (
    Request extends BaseDataRequest<OldVNT, any, infer Mixins> ? (
        RequiredMixin &
        (Mixins extends ConditionalPropsMixin<OldVNT, infer data> & infer otherMixins ? ConditionalPropsMixin<NewVNT, data> : unknown) &
        (Mixins extends VirtualPropsMixin<OldVNT, infer data> ? VirtualPropsMixin<NewVNT, data> : unknown) &
        (Mixins extends DerivedPropsMixin<OldVNT, infer data> & infer otherMixins ? DerivedPropsMixin<NewVNT, data> : unknown)
    ) : never
);

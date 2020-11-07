import { VNodeType } from "../layer2/vnode";
import { BaseDataRequest, UpdateMixin, None } from "../layer3/data-request";
import { VirtualCypherExpressionProperty, VirtualManyRelationshipProperty, VirtualOneRelationshipProperty } from "./virtual-props";
import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";


type ResetMixins<Request extends BaseDataRequest<any, any, any>, newVNodeType extends VNodeType> = (
    Request extends BaseDataRequest<any, any, infer Mixins> ? (
        ResetMixins1<Mixins, None, newVNodeType>
    ) : never
);

type ResetMixins1<OldMixins, NewMixins, newVNodeType extends VNodeType> = (
    ResetMixins2<OldMixins, 
        OldMixins extends ConditionalRawPropsMixin<any, any> ?
            NewMixins & ConditionalRawPropsMixin<newVNodeType>
        : NewMixins
    , newVNodeType>
);

type ResetMixins2<OldMixins, NewMixins, newVNodeType extends VNodeType> = (
    OldMixins extends VirtualPropsMixin<any, any> ?
        NewMixins & (
            newVNodeType extends VNodeTypeWithVirtualProps ?
                VirtualPropsMixin<newVNodeType>
            : None
        )
    : NewMixins
);


///////////////// ConditionalRawPropsMixin /////////////////////////////////////////////////////////////////////////////


/** Allow requesting raw properties conditionally, based on whether or not a "flag" is set: */
export type ConditionalRawPropsMixin<
    VNT extends VNodeType,
    conditionallyRequestedProperties extends keyof VNT["properties"] = never,
> = ({
    [propName in keyof Omit<VNT["properties"], conditionallyRequestedProperties> as `${string & propName}IfFlag`]:
        <ThisRequest>(this: ThisRequest, flagName: string) => (
            UpdateMixin<VNT, ThisRequest,
                // Change this mixin from:
                ConditionalRawPropsMixin<VNT, conditionallyRequestedProperties>,
                // to:
                ConditionalRawPropsMixin<VNT, conditionallyRequestedProperties | propName>
            >
        )
});

///////////////// VirtualPropsMixin ////////////////////////////////////////////////////////////////////////////////////

/** Allow requesting virtual properties, optionally based on whether or not a flag is set */
export type VirtualPropsMixin<
    VNT extends VNodeTypeWithVirtualProps,
    includedVirtualProps extends RecursiveVirtualPropRequest<VNT> = None,
> = ({
    [propName in keyof Omit<VNT["virtualProperties"], keyof includedVirtualProps>]:
        VNT["virtualProperties"][propName] extends VirtualManyRelationshipProperty ?
            // For each x:many virtual property, add a method for requesting that virtual property:
            <ThisRequest, SubSpec extends BaseDataRequest<VNT["virtualProperties"][propName]["target"], any, any>, FlagType extends string|undefined = undefined>
            // This is the method:
            (this: ThisRequest,
                //buildSubequest: VNodeDataRequest<VNT["virtualProperties"][propName]["target"] & ProjectRelationshipProps<VNT["virtualProperties"][propName]["relationship"]>>) => SubSpec,
                subRequest: (buildSubrequest: BaseDataRequest<VNT["virtualProperties"][propName]["target"], never, ResetMixins<ThisRequest, VNT["virtualProperties"][propName]["target"]>>) => SubSpec,
                options?: {ifFlag?: FlagType}
            ) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {ifFlag: FlagType, spec: SubSpec, type: "many"}
                    }>
                >
            )
            // The return value of the method is the same VNodeDataRequest, with the additional virtual property added in:
            // => VNodeDataRequest<VNT, includedProperties, flaggedProperties, includedVirtualProperties&{[PN in propName]: {ifFlag: FlagType, spec: SubSpec, type: "many"}}, includedDerivedProperties>

        : VNT["virtualProperties"][propName] extends VirtualOneRelationshipProperty ?
            // For each x:one virtual property, add a method for requesting that virtual property:
            <ThisRequest, SubSpec extends BaseDataRequest<VNT["virtualProperties"][propName]["target"], any, any>, FlagType extends string|undefined = undefined>
            (this: ThisRequest, subRequest: (buildSubequest: BaseDataRequest<VNT["virtualProperties"][propName]["target"], never, ResetMixins<ThisRequest, VNT["virtualProperties"][propName]["target"]>>) => SubSpec, options?: {ifFlag: FlagType}) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {ifFlag: FlagType, spec: SubSpec, type: "one"}
                    }>
                >
            )

        : VNT["virtualProperties"][propName] extends VirtualCypherExpressionProperty ?
            // Add a method to include this [virtual property based on a cypher expression], optionally toggled via a flag:
            <ThisRequest, FlagType extends string|undefined = undefined>
            (this: ThisRequest, options?: {ifFlag: FlagType}) => (
                UpdateMixin<VNT, ThisRequest,
                    VirtualPropsMixin<VNT, includedVirtualProps>,
                    VirtualPropsMixin<VNT, includedVirtualProps & {
                        [PN in propName]: {ifFlag: FlagType, type: "cypher", propertyDefinition: VNT["virtualProperties"][propName]}
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
            IncludedVirtualCypherExpressionProp<VNT["virtualProperties"][K]> :
        never
    )
}

type IncludedVirtualManyProp<propType extends VirtualManyRelationshipProperty, Spec extends BaseDataRequest<propType["target"], any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "many",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
};

type IncludedVirtualOneProp<propType extends VirtualOneRelationshipProperty, Spec extends BaseDataRequest<propType["target"], any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "one",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
};

type IncludedVirtualCypherExpressionProp<propType extends VirtualCypherExpressionProperty> = {
    ifFlag: string|undefined,
    type: "cypher",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
    propertyDefinition: propType;  // This field also doesn't exist, but is required for type inference to work
};



type AllMixins<VNT extends VNodeTypeWithVirtualProps> = ConditionalRawPropsMixin<VNT> & VirtualPropsMixin<VNT>


export type RequestVNodeProperties<
    VNT extends VNodeTypeWithVirtualProps,
    SelectedProps extends keyof VNT["properties"] = any,
    MixinData = any,
> = (emptyRequest: BaseDataRequest<VNT, never, AllMixins<VNT>>) => BaseDataRequest<VNT, SelectedProps, MixinData>;

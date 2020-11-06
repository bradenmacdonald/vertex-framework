import { VNodeType } from "../layer2/vnode";
import { BaseDataRequest, UpdateMixin, None, ConditionalRawPropsMixin } from "../layer3/data-request";
import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";


export type VirtualPropsMixin<
    VNT extends VNodeTypeWithVirtualProps,
    includedVirtualProps extends keyof VNT["virtualProperties"] = never,
> = ({
    [propName in keyof Omit<VNT["virtualProperties"], includedVirtualProps>]:
        <ThisRequest>(this: ThisRequest, flagName?: string) => (
            UpdateMixin<VNT, ThisRequest,
                // Change this mixin from:
                VirtualPropsMixin<VNT, includedVirtualProps>,
                // to:
                VirtualPropsMixin<VNT, includedVirtualProps | propName>
            >
        )
});


export function DataRequestWithFlagsAndVirtualProps<VNT extends VNodeTypeWithVirtualProps>(vnt: VNT)
    : BaseDataRequest<VNT, never, VirtualPropsMixin<VNT> & ConditionalRawPropsMixin<VNT>>
{
    return {} as BaseDataRequest<VNT, never, VirtualPropsMixin<VNT> & ConditionalRawPropsMixin<VNT>>;
}

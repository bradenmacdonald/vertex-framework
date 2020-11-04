import { VNodeType } from "../layer2/vnode";
import { VirtualPropsSchema } from "./virtual-props";

export const VNodeTypeWithVirtualProps = VNodeType;

export interface VNodeTypeWithVirtualProps extends VNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

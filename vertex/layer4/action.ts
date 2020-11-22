import { C } from "../layer2/cypher-sugar";
import { registerVNodeType } from "../layer2/vnode-base";
import { Action } from "../layer3/action";
import { VirtualPropType } from "./virtual-props";


export class ActionWithVirtualProperties extends Action {
    static readonly virtualProperties = {
        revertedBy: {
            type: VirtualPropType.OneRelationship,
            query: C`(@target:${Action})-[:${Action.rel.REVERTED}]->(@this)`,
            target: ActionWithVirtualProperties,
        },
        revertedAction: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${Action.rel.REVERTED}]->(@target:${Action})`,
            target: ActionWithVirtualProperties,
        },
    };
    static readonly derivedProperties = {};
}
registerVNodeType(ActionWithVirtualProperties);
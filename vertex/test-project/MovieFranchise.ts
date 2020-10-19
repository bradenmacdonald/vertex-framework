import Joi from "@hapi/joi";
import { registerVNodeType, VNodeType, ShortIdProperty, VirtualPropType } from "../vnode";
import { defaultUpdateActionFor, defaultCreateFor } from "../action";
import { Movie, MovieLabel } from "./Movie";

/**
 * A Movie Franchise VNode for testing
 */
export class MovieFranchise extends VNodeType {
    static readonly label = "TestMovieFranchise";
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        name: Joi.string().required(),
    };
    static readonly defaultOrderBy = "name";
    static readonly virtualProperties = {
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: `(@this)<-[:FRANCHISE_IS]-(@target:${MovieLabel})`,
            target: Movie,
        },
    };
}
registerVNodeType(MovieFranchise);

// Parameters for the "UpdateMovieFranchise" Action
interface UpdateArgs {
    shortId?: string;
    name?: string;
}
export const UpdateMovieFranchise = defaultUpdateActionFor<UpdateArgs>(MovieFranchise, {
    mutableProperties: ["shortId", "name"],
});

export const CreateMovieFranchise = defaultCreateFor<{shortId: string, name: string}, UpdateArgs>(MovieFranchise, UpdateMovieFranchise);

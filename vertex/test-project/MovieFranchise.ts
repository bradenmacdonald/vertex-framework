import Joi from "@hapi/joi";
import {
    C,
    registerVNodeType,
    VNodeType,
    ShortIdProperty,
    VirtualPropType,
    defaultUpdateActionFor,
    defaultCreateFor,
} from "../";
import { MovieRef as Movie } from "./Movie";

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
    static readonly defaultOrderBy = "@this.name";
    static readonly virtualProperties = {
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)<-[:FRANCHISE_IS]-(@target:${Movie})`,
            target: Movie,
        },
    };
}
registerVNodeType(MovieFranchise);

// Note: for MovieFranchise, we test having only a Create action; no update.
export const CreateMovieFranchise = defaultCreateFor(MovieFranchise, ["shortId", "name"]);

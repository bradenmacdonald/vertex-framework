import Joi from "@hapi/joi";
import {
    C,
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
@VNodeType.declare
export class MovieFranchise extends VNodeType {
    static label = "TestMovieFranchise";
    static properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        name: Joi.string().required(),
    };
    static defaultOrderBy = "@this.name";
    static virtualProperties = VNodeType.hasVirtualProperties({
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)<-[:${Movie.rel.FRANCHISE_IS}]-(@target:${Movie})`,
            target: Movie,
        },
    });
}

// Note: for MovieFranchise, we test having only a Create action; no update.
export const CreateMovieFranchise = defaultCreateFor(MovieFranchise, f => f.shortId.name);

import Joi from "@hapi/joi";
import { registerVNodeType, VNodeType, ShortIdProperty } from "../vnode";
import { defaultUpdateActionFor, defaultCreateFor } from "../action";

/**
 * A Movie VNode for testing
 */
export class Movie extends VNodeType {
    static readonly label = "TestMovie";
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        title: Joi.string().required(),
        year: Joi.number().integer().min(1888).max(2200).required(),
    };
    static readonly defaultOrderBy = "year DESC";
}
registerVNodeType(Movie);

// Parameters for the "UpdateMovie" Action
interface UpdateArgs {
    shortId?: string;
    title?: string;
    year?: number;
}
export const UpdateMovie = defaultUpdateActionFor<UpdateArgs>(Movie, {
    mutableProperties: ["shortId", "title", "year"],
});

export const CreateMovie = defaultCreateFor<{shortId: string, title: string, year: number}, UpdateArgs>(Movie, UpdateMovie);

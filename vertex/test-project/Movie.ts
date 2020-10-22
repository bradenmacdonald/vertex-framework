import Joi from "@hapi/joi";
import {
    defaultUpdateActionFor,
    defaultCreateFor,
    updateOneToOneRelationship,
    registerVNodeType,
    VNodeType,
    ShortIdProperty,
    VirtualPropType,
} from "../";

export const MovieLabel = "TestMovie";
import { MovieFranchise } from "./MovieFranchise";

/**
 * A Movie VNode for testing
 */
export class Movie extends VNodeType {
    static readonly label = MovieLabel;
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        title: Joi.string().required(),
        year: Joi.number().integer().min(1888).max(2200).required(),
    };
    static readonly defaultOrderBy = "year DESC";
    static readonly relationshipsFrom = {
        /** This Movie is part of a franchise */
        FRANCHISE_IS: {
            toLabels: [MovieFranchise.label],
            properties: {},
        },
    };
    static readonly virtualProperties = {
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: `(@this)-[:FRANCHISE_IS]->(@target:${MovieFranchise.label})`,
            target: MovieFranchise,
        },
    };
}
registerVNodeType(Movie);

// Parameters for the "UpdateMovie" Action
interface UpdateArgs {
    shortId?: string;
    title?: string;
    year?: number;
    franchiseId?: string|null;
}
export const UpdateMovie = defaultUpdateActionFor<UpdateArgs>(Movie, {
    mutableProperties: ["shortId", "title", "year"],
    otherUpdates: async ({tx, data, nodeSnapshot}) => {
        const previousValues: Partial<UpdateArgs> = {};
        if (data.franchiseId !== undefined) {
            const {previousUuid} = await updateOneToOneRelationship({
                fromType: Movie,
                uuid: nodeSnapshot.uuid,
                tx,
                relName: "FRANCHISE_IS",
                newId: data.franchiseId,
                allowNull: true,
            });
            previousValues.franchiseId = previousUuid;
        }
        return {
            additionalModifiedNodes: [],
            previousValues,
        };
    },
});

export const CreateMovie = defaultCreateFor<{shortId: string, title: string, year: number}, UpdateArgs>(Movie, UpdateMovie);

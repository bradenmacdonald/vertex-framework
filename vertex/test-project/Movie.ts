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

interface UpdateMovieExtraArgs {
    franchiseId?: string|null;
}

export const UpdateMovie = defaultUpdateActionFor(Movie, ["shortId", "title", "year"], {
    otherUpdates: async (args: UpdateMovieExtraArgs, tx, nodeSnapshot, changes) => {
        const previousValues: Partial<UpdateMovieExtraArgs> = {};
        if (args.franchiseId !== undefined) {
            const {previousUuid} = await updateOneToOneRelationship({
                fromType: Movie,
                uuid: nodeSnapshot.uuid,
                tx,
                relName: "FRANCHISE_IS",
                newId: args.franchiseId,
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

export const CreateMovie = defaultCreateFor(Movie, ["shortId", "title", "year"], UpdateMovie);

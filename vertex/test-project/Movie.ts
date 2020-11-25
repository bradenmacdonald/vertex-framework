import Joi from "@hapi/joi";
import {
    C,
    defaultUpdateActionFor,
    defaultCreateFor,
    registerVNodeType,
    VNodeType,
    VNodeTypeRef,
    ShortIdProperty,
    VirtualPropType,
    VNodeRelationship,
} from "../";

// When necessary to avoid circular references, this pattern can be used to create a "Forward Reference" to a VNodeType:
export const MovieRef: typeof Movie = VNodeTypeRef("TestMovie");
import { MovieFranchise } from "./MovieFranchise";


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
    static readonly defaultOrderBy = "@this.year DESC";
    static readonly rel = Movie.hasRelationshipsFromThisTo({
        /** This Movie is part of a franchise */
        FRANCHISE_IS: {
            to: [MovieFranchise],
            properties: {},
            cardinality: VNodeRelationship.Cardinality.ToOneOrNone,
        },
    });
    static readonly virtualProperties = {
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${Movie.rel.FRANCHISE_IS}]->(@target:${MovieFranchise})`,
            target: MovieFranchise,
        },
    };
}
registerVNodeType(Movie);

interface UpdateMovieExtraArgs {
    franchiseId?: string|null;
}

export const UpdateMovie = defaultUpdateActionFor(Movie, m => m.shortId.title.year, {
    otherUpdates: async (args: UpdateMovieExtraArgs, tx, nodeSnapshot, changes) => {
        const previousValues: Partial<UpdateMovieExtraArgs> = {};
        if (args.franchiseId !== undefined) {
            await tx.updateToOneRelationship({
                from: [Movie, nodeSnapshot.uuid],
                rel: Movie.rel.FRANCHISE_IS,
                to: args.franchiseId,
            }).then(({prevTo}) => previousValues.franchiseId = prevTo.key);
        }
        return {
            additionalModifiedNodes: [],
            previousValues,
        };
    },
});

export const CreateMovie = defaultCreateFor(Movie, m => m.shortId.title.year, UpdateMovie);

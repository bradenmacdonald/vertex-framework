import {
    C,
    defaultUpdateFor,
    defaultCreateFor,
    VNodeType,
    VirtualPropType,
    Field,
} from "../index.ts";

import { MovieFranchise } from "./MovieFranchise.ts";


/**
 * A Movie VNode for testing
 */
export class Movie extends VNodeType {
    static label = "TestMovie";
    static properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
        title: Field.String,
        year: Field.Int.Check(v => {
            if (typeof v !=="number" || v < 1888 || v > 2200) { throw new Error("Invalid year"); }
            return v;
        }),
    };
    static defaultOrderBy = "@this.year DESC";
    static rel = this.hasRelationshipsFromThisTo({
        /** This Movie is part of a franchise */
        FRANCHISE_IS: {
            to: [MovieFranchise],
            properties: {},
            cardinality: VNodeType.Rel.ToOneOrNone,
        },
    });
    static virtualProperties = this.hasVirtualProperties({
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${this.rel.FRANCHISE_IS}]->(@target:${MovieFranchise})`,
            target: MovieFranchise,
        },
    });
}

interface UpdateMovieExtraArgs {
    franchiseSlugId?: string|null;
}

export const UpdateMovie = defaultUpdateFor(Movie, m => m.slugId.title.year, {
    otherUpdates: async (args: UpdateMovieExtraArgs, tx, nodeSnapshot) => {
        if (args.franchiseSlugId !== undefined) {
            const franchiseId = await tx.pullOne(MovieFranchise, f => f.id, {with: {slugId: args.franchiseSlugId}});
            await tx.updateToOneRelationship({
                from: [Movie, nodeSnapshot.id],
                rel: Movie.rel.FRANCHISE_IS,
                to: franchiseId,
            });
        }
        return {
            additionalModifiedNodes: [],
        };
    },
});

export const CreateMovie = defaultCreateFor(Movie, m => m.slugId.title.year, UpdateMovie);

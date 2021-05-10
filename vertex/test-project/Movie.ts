import {
    C,
    defaultUpdateActionFor,
    defaultCreateFor,
    VNodeType,
    VNodeTypeRef,
    VirtualPropType,
} from "../";
import { Field } from "../layer2/field";

// When necessary to avoid circular references, this pattern can be used to create a "Forward Reference" to a VNodeType:
export const MovieRef: typeof Movie = VNodeTypeRef("TestMovie");
import { MovieFranchise } from "./MovieFranchise";


/**
 * A Movie VNode for testing
 */
@VNodeType.declare
export class Movie extends VNodeType {
    static label = "TestMovie";
    static properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
        title: Field.String,
        year: Field.Int.Check(y => y.min(1888).max(2200)),
    };
    static defaultOrderBy = "@this.year DESC";
    static rel = VNodeType.hasRelationshipsFromThisTo({
        /** This Movie is part of a franchise */
        FRANCHISE_IS: {
            to: [MovieFranchise],
            properties: {},
            cardinality: VNodeType.Rel.ToOneOrNone,
        },
    });
    static virtualProperties = VNodeType.hasVirtualProperties({
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${Movie.rel.FRANCHISE_IS}]->(@target:${MovieFranchise})`,
            target: MovieFranchise,
        },
    });
}

interface UpdateMovieExtraArgs {
    franchiseId?: string|null;
}

export const UpdateMovie = defaultUpdateActionFor(Movie, m => m.slugId.title.year, {
    otherUpdates: async (args: UpdateMovieExtraArgs, tx, nodeSnapshot, changes) => {
        const previousValues: Partial<UpdateMovieExtraArgs> = {};
        if (args.franchiseId !== undefined) {
            await tx.updateToOneRelationship({
                from: [Movie, nodeSnapshot.id],
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

export const CreateMovie = defaultCreateFor(Movie, m => m.slugId.title.year, UpdateMovie);

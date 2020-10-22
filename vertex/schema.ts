/**
 * The core database Schema for a Vertex Framework application
 */
import { Migration } from "./vertex-interface";
import { UUID, normalizeUUID } from "./lib/uuid";

// The UUID of the system user.
export const SYSTEM_UUID: UUID = normalizeUUID("00000000-0000-0000-0000-000000000000");

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    "_root": {
        // This is the root migration, which sets up the schema so we can track all other migrations.
        forward: (dbWrite) => dbWrite(tx =>
            tx.run("CREATE CONSTRAINT migration_id_uniq ON (m:Migration) ASSERT m.id IS UNIQUE")
        ),
        backward: (dbWrite) => dbWrite(tx =>
            tx.run("DROP CONSTRAINT migration_id_uniq")
        ),
        dependsOn: [],
    },
    core: {
        forward: async (dbWrite, declareModel) => {
            await declareModel("User", {shortId: true});
            await dbWrite(async tx => {
                await tx.run("CREATE CONSTRAINT user_email_uniq ON (u:User) ASSERT u.email IS UNIQUE");
                await tx.run("CREATE CONSTRAINT user_username_uniq ON (u:User) ASSERT u.username IS UNIQUE");
            });
            await declareModel("Action");
            // Slugs, used to identify TechNodes
            await dbWrite(async tx => {
                await tx.run("CREATE CONSTRAINT shortid_path_uniq ON (s:ShortId) ASSERT s.path IS UNIQUE");
            });
            // Create the triggers that maintain slug relationships for models that use slugs as identifiers:
            await dbWrite(async tx => {
                // 1) Whenever a new node (TechNode) is created, if it has a shortId property, create a :ShortId node
                //    with a relationship to the TechNode.
                await tx.run(`
                    CALL apoc.trigger.add("createShortIdRelation","
                        UNWIND $createdNodes AS n
                        WITH n
                        WHERE EXISTS(n.shortId)
                        CREATE (:ShortId {path: labels(n)[0] + '/' + n.shortId, timestamp: datetime()})-[:IDENTIFIES]->(n)
                    ", {phase:"before"})
                `);
                // 2) Whenever a new shortId property value is set on an existing node (TechNode), create a :ShortId node
                //    with a relationship to that TechNode.
                //    If the ShortId already exists, update its timestamp to make it the "current" one
                await tx.run(`
                    CALL apoc.trigger.add("updateShortIdRelation", "
                        UNWIND apoc.trigger.propertiesByKey($assignedNodeProperties, 'shortId') AS prop
                        WITH prop.node as n, prop.old as oldShortId
                        WHERE n.shortId IS NOT NULL AND n.shortId <> oldShortId
                        MERGE (s:ShortId {path: labels(n)[0] + '/' + n.shortId})-[:IDENTIFIES]->(n)
                        SET s.timestamp = datetime()
                    ", {phase: "before"})
                `);
                // There is no delete trigger because deletions should generally be handled by re-labelling nodes to
                // use a "Deleted_____" label, not actually deleting the nodes.
            });
            // Create the system user. This is a "bootstrap" User/Action because every user must be created via an
            // action and every action must be performed by a user. So here the system user creates itself.
            await dbWrite(tx => tx.run(`
                CREATE (u:User {
                    uuid: "${SYSTEM_UUID}",
                    shortId: "system",
                    realname: "System"
                })-[:PERFORMED]->(a:Action {
                    // A UUID will be created automatically by apoc extension.
                    type: "CreateUser",
                    data: "{}",
                    timestamp: datetime(),
                    tookMs: 0
                })
            `));
        },
        backward: async (dbWrite, _, removeModel) => {
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("createShortIdRelation")`));
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("updateShortIdRelation")`));
            await dbWrite(tx => tx.run(`MATCH (s:ShortId) DETACH DELETE s`));
            await dbWrite(tx => tx.run("DROP CONSTRAINT shortid_path_uniq")),
            await removeModel("Action");
            await dbWrite(tx => tx.run("DROP CONSTRAINT user_email_uniq")),
            await dbWrite(tx => tx.run("DROP CONSTRAINT user_username_uniq")),
            await removeModel("User", {shortId: true});
        },
        dependsOn: ["_root"],
    },
    trackActionChanges: {
        forward: async (dbWrite) => {
            // Other than migrations, all changes (writes) to the database must be associated with an "Action";
            // the Action node will be automatically created as part of the write transaction by the action-runner code.
            // The Action _must_ include a -[:MODIFIED]-> relationship to every node that it modified (created, updated,
            // marked as Deleted, or created a relationship from).
            // Creating a relationship (a)-[:REL]->(b) only counts as modifying (a), not (b)
            //
            // The purpose of this trigger is to enforce these constraints by checking the transaction before it commits,
            // and throwing an error (aborting the transaction) if it does not correctly mark the action as having
            // MODIFIED the right nodes.
            //
            // This trigger will complain if an Action is marked as modifying a node that it didn't actually modify,
            // although that should also be avoided.
            //
            // This trigger would normally cause issues for schema migrations and data migrations, so the migrator code
            // explicitly pauses and resumes this trigger during each migration.
            await dbWrite(async tx => {
                await tx.run(`
                    CALL apoc.trigger.add("trackActionChanges", "

                        WITH [n IN $createdNodes WHERE n:Action] AS actions
                            CALL apoc.util.validate(
                                size(actions) <> 1,
                                'every data write transaction should be associated with one Action, found %d', [size(actions)]
                            )
                        WITH head(actions) AS action

                        WITH
                            action,

                            // Check that any newly created nodes are included in the list of nodes :MODIFIED by the current Action
                            [
                                n IN $createdNodes WHERE NOT n:Action AND NOT n:ShortId
                                | {node: n, reason: 'created node'}
                            ] AS createdNodes,

                            // Check that any nodes with modified properties are included in the list of nodes :MODIFIED by the current Action
                            [
                                modProp IN apoc.coll.flatten(
                                    apoc.map.values($assignedNodeProperties, keys($assignedNodeProperties)) +
                                    apoc.map.values($removedNodeProperties, keys($removedNodeProperties))
                                )
                                | {node: modProp.node, reason: 'modified property ' + modProp.key}
                            ] AS modifiedProps,

                            // Check that any modified relationships have their 'from' node included in the list of :MODIFIED nodes:
                            [
                                rel IN ($createdRelationships + $deletedRelationships)
                                WHERE type(rel) <> 'PERFORMED' AND type(rel) <> 'MODIFIED' AND type(rel) <> 'IDENTIFIES'
                                | {node: startNode(rel), reason: 'added/deleted :'+type(rel)+' relationship'}
                            ] AS createdOrDeletedRelationships

                        UNWIND (createdNodes + modifiedProps + createdOrDeletedRelationships) AS change
                            WITH action, change.node AS node, change.reason AS reason
                                WHERE node <> action AND none(x IN $deletedNodes WHERE id(x) = id(node))
                                OPTIONAL MATCH (action)-[rel:MODIFIED]->(node)
                                CALL apoc.util.validate(
                                    rel IS NULL,
                                    'A :%s node was modified by this %s action (%s) but not explicitly marked as modified by the Action.',
                                    [head(labels(node)), action.type, reason]
                                )

                        RETURN null
                    ", {phase: "before"})
                `);
                // Pause the trigger immediately, or it will complain about the upcoming migrations themselves; the migration code will resume it
                await tx.run(`CALL apoc.trigger.pause("trackActionChanges")`);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("trackActionChanges")`));
        },
        dependsOn: ["core"],
    },
});

// deno-lint-ignore-file no-explicit-any
import { group, test, assertType, IsExact, IsPropertyOptional, IsPropertyPresent } from "../lib/tests.ts";

import type { BaseDataRequest, VNID, VDate } from "../index.ts";
import { Person } from "../test-project/index.ts";
import type { DataResponse } from "./data-response.ts";
import { VNodeTypeWithVirtualProps } from "./vnode.ts";
import { ConditionalPropsMixin, VirtualPropsMixin } from "./data-request-mixins.ts";
import { BaseVNodeType } from "../layer2/vnode-base.ts";
import { RequiredMixin } from "../layer2/data-request.ts";


group(import.meta, () => {
    // Compile-time tests of DataResponse typing

    group("Requests with only raw properties and conditional/flagged raw properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and conditional (flagged) raw properties.
        // This does not include the mixins to support virtual or derived properties.
        function newDataRequest<VNT extends BaseVNodeType>(_vnodeType: VNT): BaseDataRequest<VNT, never, RequiredMixin & ConditionalPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.name, string>>(true);
            assertType<IsExact<typeof response["name"], string>>(true);
            assertType<IsPropertyPresent<typeof response, "id">>(false);
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.name, string>>(true);
            assertType<IsExact<typeof response["name"], string>>(true);
            assertType<IsExact<typeof response["id"], VNID>>(true);
            assertType<IsExact<typeof response["dateOfBirth"], VDate>>(true);
            assertType<IsExact<typeof response["slugId"], string>>(true);
            assertType<IsPropertyPresent<typeof response, "other">>(false);
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsPropertyOptional<typeof response, "name">>(true);
            assertType<IsExact<typeof response["name"], string|undefined>>(true);
            assertType<IsPropertyPresent<typeof response, "id">>(false);
        });
    });

    group("Requests with raw properties, conditional/flagged raw properties, and virtual properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and virtual properties.
        // This does not include the mixins to support derived properties.
        function newDataRequest<VNT extends VNodeTypeWithVirtualProps>(_vnodeType: VNT): BaseDataRequest<VNT, never, RequiredMixin & ConditionalPropsMixin<VNT> & VirtualPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.name, string>>(true);
            assertType<IsPropertyPresent<typeof response, "id">>(false);
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.name, string>>(true);
            assertType<IsExact<typeof response.id, VNID>>(true);
            assertType<IsExact<typeof response.dateOfBirth, VDate>>(true);
            assertType<IsExact<typeof response.slugId, string>>(true);
            assertType<IsPropertyPresent<typeof response, "other">>(false);
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsPropertyOptional<typeof response, "name">>(true);
            assertType<IsExact<typeof response.name, string|undefined>>(true);
            assertType<IsPropertyPresent<typeof response, "id">>(false);
        });

        test("Request a raw property and conditionally Request another raw property", () => {

            const request = newDataRequest(Person).slugId.if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.slugId, string>>(true);
            assertType<IsPropertyOptional<typeof response, "name">>(true);
            assertType<IsExact<typeof response.name, string|undefined>>(true);
            assertType<IsPropertyPresent<typeof response, "id">>(false);
        });

        test("Request a virtual property", () => {

            const request = newDataRequest(Person).age().id.if("d", p => p.slugId).if("test", p => p.dateOfBirth);
            const response: DataResponse<typeof request> = undefined as any;

            assertType<IsExact<typeof response.age, number>>(true);
            assertType<IsExact<typeof response.id, VNID>>(true);
            assertType<IsPropertyOptional<typeof response, "slugId", string>>(true);
            assertType<IsExact<typeof response.slugId, string|undefined>>(true);
            assertType<IsPropertyOptional<typeof response, "dateOfBirth">>(true);
            assertType<IsExact<typeof response.dateOfBirth, VDate|undefined>>(true);
            assertType<IsPropertyPresent<typeof response, "other">>(false);
        });

        test("Complex request using all mixins and including a projected property", () => {
            const request = (newDataRequest(Person)
                .id
                .friends(f => f
                    .name
                    .if("flag", f => f.dateOfBirth.age())
                    .costars(cs => cs
                        .name
                        .movies(m => m.title.year.role())  // <-- note "role" is a projected property, which comes from the relationship and is not normally part of "Movie"
                    )
                )
            );
            const response: DataResponse<typeof request> = undefined as any;
            assertType<IsExact<typeof response.id, VNID>>(true);
            assertType<IsExact<typeof response.friends[0]["name"], string>>(true);
            assertType<IsExact<typeof response.friends[0]["dateOfBirth"], VDate|undefined>>(true);
            assertType<IsExact<typeof response.friends[0]["age"], number|undefined>>(true);
            const costar = response?.friends[0].costars[0];  // The ? is just to make this work at runtime since we're using a mock.
            assertType<IsExact<typeof costar.name, string>>(true);
            assertType<IsPropertyPresent<typeof costar, "id">>(false);
            assertType<IsExact<typeof costar.movies[0]["title"], string>>(true);
            assertType<IsExact<typeof costar.movies[0]["year"], number>>(true);
            assertType<IsExact<typeof costar.movies[0]["role"], string>>(true);
            assertType<IsPropertyPresent<typeof costar.movies[0], "id">>(false);
        });
    });
});

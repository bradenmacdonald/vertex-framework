import { suite, test } from "../lib/intern-tests";

import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "../lib/ts-utils";
import type { BaseDataRequest, VNID, VDate } from "..";
import { Person } from "../test-project";
import type { DataResponse } from "./data-response";
import { VNodeTypeWithVirtualProps } from "./vnode";
import { ConditionalPropsMixin, VirtualPropsMixin } from "./data-request-mixins";
import { BaseVNodeType } from "../layer2/vnode-base";
import { RequiredMixin } from "../layer3/data-request";


suite("DataResponse", () => {
    // Compile-time tests of DataResponse typing

    suite("Requests with only raw properties and conditional/flagged raw properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and conditional (flagged) raw properties.
        // This does not include the mixins to support virtual or derived properties.
        function newDataRequest<VNT extends BaseVNodeType>(vnodeType: VNT): BaseDataRequest<VNT, never, RequiredMixin & ConditionalPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "id">>();
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyPresent<typeof response, "id", VNID>>();
            checkType<AssertPropertyPresent<typeof response, "dateOfBirth", VDate>>();
            checkType<AssertPropertyPresent<typeof response, "slugId", string>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "id">>();
        });
    });

    suite("Requests with raw properties, conditional/flagged raw properties, and virtual properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and virtual properties.
        // This does not include the mixins to support derived properties.
        function newDataRequest<VNT extends VNodeTypeWithVirtualProps>(vnodeType: VNT): BaseDataRequest<VNT, never, RequiredMixin & ConditionalPropsMixin<VNT> & VirtualPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "id">>();
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyPresent<typeof response, "id", VNID>>();
            checkType<AssertPropertyPresent<typeof response, "dateOfBirth", VDate>>();
            checkType<AssertPropertyPresent<typeof response, "slugId", string>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "id">>();
        });

        test("Request a raw property and conditionally Request another raw property", () => {

            const request = newDataRequest(Person).slugId.if("someFlag", p => p.name);
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyPresent<typeof response, "slugId", string>>();
            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "id">>();
        });

        test("Request a virtual property", () => {

            const request = newDataRequest(Person).age().id.if("d", p => p.slugId).if("test", p => p.dateOfBirth);
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyPresent<typeof response, "age", number>>();
            checkType<AssertPropertyPresent<typeof response, "id", VNID>>();
            checkType<AssertPropertyOptional<typeof response, "slugId", string>>();
            checkType<AssertPropertyOptional<typeof response, "dateOfBirth", VDate>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
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
            checkType<AssertPropertyPresent<typeof response, "id", VNID>>();
            checkType<AssertPropertyPresent<typeof response.friends[0], "name", string>>();
            checkType<AssertPropertyOptional<typeof response.friends[0], "dateOfBirth", VDate>>();
            checkType<AssertPropertyOptional<typeof response.friends[0], "age", number>>();
            const costar = response?.friends[0].costars[0];  // The ? is just to make this work at runtime since we're using a mock.
            checkType<AssertPropertyPresent<typeof costar, "name", string>>();
            checkType<AssertPropertyAbsent<typeof costar, "id">>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "title", string>>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "year", number>>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "role", string|null>>();  // Projected properties are always nullable
            checkType<AssertPropertyAbsent<typeof costar.movies[0], "id">>();
        });
    });
});

import { suite, test } from "../lib/intern-tests";

import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "../lib/ts-utils";
import type { BaseDataRequest, UUID } from "..";
import { Person } from "../test-project";
import type { DataResponse } from "./data-response";
import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";
import { ConditionalRawPropsMixin, VirtualPropsMixin } from "./data-request-mixins";
import { VNodeType } from "../layer2/vnode";


suite("DataResponse", () => {
    // Compile-time tests of DataResponse typing

    suite("Requests with only raw properties and conditional/flagged raw properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and conditional (flagged) raw properties.
        // This does not include the mixins to support virtual or derived properties.
        function newDataRequest<VNT extends VNodeType>(vnodeType: VNT): BaseDataRequest<VNT, never, ConditionalRawPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "uuid">>();
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyPresent<typeof response, "uuid", UUID>>();
            checkType<AssertPropertyPresent<typeof response, "dateOfBirth", string>>();
            checkType<AssertPropertyPresent<typeof response, "shortId", string>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).nameIfFlag("someFlag");
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "uuid">>();
        });
    });

    suite("Requests with raw properties, conditional/flagged raw properties, and virtual properties", () => {

        // A helper function to create a typed DataRequest that supports raw properties and virtual properties.
        // This does not include the mixins to support derived properties.
        function newDataRequest<VNT extends VNodeTypeWithVirtualProps>(vnodeType: VNT): BaseDataRequest<VNT, never, ConditionalRawPropsMixin<VNT> & VirtualPropsMixin<VNT>> {
            // These tests only test typing so we don't have to actually implement this method.
            // Just return a Mock object to allow the chaining to work when building the request.
            return new Proxy({}, { get: (_, propName, proxy) => (propName in Person.properties ? proxy : () => proxy), }) as any;
        }

        test("Request a single raw property", () => {

            const request = newDataRequest(Person).name;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "uuid">>();
        });

        test("Request all properties", () => {

            const request = newDataRequest(Person).allProps;
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertEqual<typeof response.name, string>>();
            checkType<AssertPropertyPresent<typeof response, "name", string>>();
            checkType<AssertPropertyPresent<typeof response, "uuid", UUID>>();
            checkType<AssertPropertyPresent<typeof response, "dateOfBirth", string>>();
            checkType<AssertPropertyPresent<typeof response, "shortId", string>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
        });

        test("Conditionally Request a single raw property", () => {

            const request = newDataRequest(Person).nameIfFlag("someFlag");
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "uuid">>();
        });

        test("Request a raw property and conditionally Request another raw property", () => {

            const request = newDataRequest(Person).shortId.nameIfFlag("someFlag");
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyPresent<typeof response, "shortId", string>>();
            checkType<AssertPropertyOptional<typeof response, "name", string>>();
            checkType<AssertPropertyAbsent<typeof response, "uuid">>();
        });

        test("Request a virtual property", () => {

            const request = newDataRequest(Person).age().uuid.shortIdIfFlag("d").dateOfBirthIfFlag("test");
            const response: DataResponse<typeof request> = undefined as any;

            checkType<AssertPropertyPresent<typeof response, "age", number>>();
            checkType<AssertPropertyPresent<typeof response, "uuid", UUID>>();
            checkType<AssertPropertyOptional<typeof response, "shortId", string>>();
            checkType<AssertPropertyOptional<typeof response, "dateOfBirth", string>>();
            checkType<AssertPropertyAbsent<typeof response, "other">>();
        });

        test("Complex request using all mixins and including a projected property", () => {
            const request = (newDataRequest(Person)
                .uuid
                .friends(f => f
                    .name
                    .dateOfBirthIfFlag("flag")
                    .costars(cs => cs
                        .name
                        .movies(m => m.title.year.role())  // <-- note "role" is a projected property, which comes from the relationship and is not normally part of "Movie"
                    )
                )
            );
            const response: DataResponse<typeof request> = undefined as any;
            checkType<AssertPropertyPresent<typeof response, "uuid", UUID>>();
            checkType<AssertPropertyPresent<typeof response.friends[0], "name", string>>();
            checkType<AssertPropertyOptional<typeof response.friends[0], "dateOfBirth", string>>();
            const costar = response?.friends[0].costars[0];  // The ? is just to make this work at runtime since we're using a mock.
            checkType<AssertPropertyPresent<typeof costar, "name", string>>();
            checkType<AssertPropertyAbsent<typeof costar, "uuid">>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "title", string>>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "year", number>>();
            checkType<AssertPropertyPresent<typeof costar.movies[0], "role", string|null>>();  // Projected properties are always nullable
            checkType<AssertPropertyAbsent<typeof costar.movies[0], "uuid">>();
        });
    });
});

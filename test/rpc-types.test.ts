import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expectTypeOf, it } from "vitest";
import type { CreateSpaceRequest, CreateUserRequest, Space, SpaceList, User, UserList } from "../src/api/types";
import type { AppType } from "../src/index";
import { ORIGIN } from "./helpers";

// These assertions are checked by `pnpm typecheck`, not at runtime.
const client = hc<AppType>(ORIGIN);

type CreateUserJson = InferRequestType<typeof client.api.v1.users.$post>["json"];
type CreateSpaceJson = InferRequestType<typeof client.api.v1.spaces.$post>["json"];

describe("AppType", () => {
  it("types the request body of POST /api/v1/users", () => {
    expectTypeOf<CreateUserJson>().toEqualTypeOf<CreateUserRequest>();
    const withoutName: CreateUserJson = { email: "a@example.com", password: "correct horse battery", role: "member" };
    // @ts-expect-error role must be admin or member
    const owner: CreateUserJson = { email: "a@example.com", password: "correct horse battery", role: "owner" };
    void withoutName;
    void owner;
  });

  it("types the request body of POST /api/v1/spaces", () => {
    expectTypeOf<CreateSpaceJson>().toEqualTypeOf<CreateSpaceRequest>();
    const everyone: CreateSpaceJson = { kind: "everyone", name: "Everyone" };
    // @ts-expect-error personal spaces cannot be created through the API
    const personal: CreateSpaceJson = { kind: "personal", name: "Mine" };
    void everyone;
    void personal;
  });

  it("types successful response bodies", () => {
    expectTypeOf<InferResponseType<typeof client.api.v1.me.$get, 200>>().toEqualTypeOf<User>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$get, 200>>().toEqualTypeOf<UserList>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$post, 201>>().toEqualTypeOf<User>();
    expectTypeOf<InferResponseType<typeof client.api.v1.spaces.$get, 200>>().toEqualTypeOf<SpaceList>();
    expectTypeOf<InferResponseType<typeof client.api.v1.spaces.$post, 201>>().toEqualTypeOf<Space>();
  });
});

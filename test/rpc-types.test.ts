import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expectTypeOf, it } from "vitest";
import type { CreateUserRequest, User, UserList } from "../src/api/types";
import type { AppType } from "../src/index";
import { ORIGIN } from "./helpers";

// These assertions are checked by `pnpm typecheck`, not at runtime.
const client = hc<AppType>(ORIGIN);

type CreateUserJson = InferRequestType<typeof client.api.v1.users.$post>["json"];

describe("AppType", () => {
  it("types the request body of POST /api/v1/users", () => {
    expectTypeOf<CreateUserJson>().toEqualTypeOf<CreateUserRequest>();
    const withoutName: CreateUserJson = { email: "a@example.com", password: "correct horse battery", role: "member" };
    // @ts-expect-error role must be admin or member
    const owner: CreateUserJson = { email: "a@example.com", password: "correct horse battery", role: "owner" };
    void withoutName;
    void owner;
  });

  it("types successful response bodies", () => {
    expectTypeOf<InferResponseType<typeof client.api.v1.me.$get, 200>>().toEqualTypeOf<User>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$get, 200>>().toEqualTypeOf<UserList>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$post, 201>>().toEqualTypeOf<User>();
  });
});

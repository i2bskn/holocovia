import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expectTypeOf, it } from "vitest";
import type {
  CreatePageRequest,
  CreateSpaceRequest,
  CreateUserRequest,
  Page,
  PageList,
  SearchResult,
  Space,
  SpaceList,
  UpdatePageRequest,
  User,
  UserList,
} from "../src/api/types";
import type { AppType } from "../src/index";
import { ORIGIN } from "./helpers";

// These assertions are checked by `pnpm typecheck`, not at runtime.
const client = hc<AppType>(ORIGIN);

type CreateUserJson = InferRequestType<typeof client.api.v1.users.$post>["json"];
type CreateSpaceJson = InferRequestType<typeof client.api.v1.spaces.$post>["json"];
type CreatePageJson = InferRequestType<(typeof client.api.v1.spaces)[":id"]["pages"]["$post"]>["json"];
type UpdatePageJson = InferRequestType<(typeof client.api.v1.pages)[":id"]["$patch"]>["json"];
type SearchQuery = InferRequestType<typeof client.api.v1.search.$get>["query"];

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

  it("types the request bodies of page creation and update", () => {
    expectTypeOf<CreatePageJson>().toEqualTypeOf<CreatePageRequest>();
    expectTypeOf<UpdatePageJson>().toEqualTypeOf<UpdatePageRequest>();
    const titleOnly: UpdatePageJson = { version: 1, title: "Title" };
    // @ts-expect-error version is required for optimistic locking
    const withoutVersion: UpdatePageJson = { title: "Title" };
    void titleOnly;
    void withoutVersion;
  });

  it("types the query of GET /api/v1/search", () => {
    expectTypeOf<SearchQuery["q"]>().toEqualTypeOf<string>();
    const withSpace: SearchQuery = { q: "plan", space_id: "s1" };
    // @ts-expect-error q is required
    const withoutQ: SearchQuery = { space_id: "s1" };
    void withSpace;
    void withoutQ;
  });

  it("types successful response bodies", () => {
    expectTypeOf<InferResponseType<typeof client.api.v1.me.$get, 200>>().toEqualTypeOf<User>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$get, 200>>().toEqualTypeOf<UserList>();
    expectTypeOf<InferResponseType<typeof client.api.v1.users.$post, 201>>().toEqualTypeOf<User>();
    expectTypeOf<InferResponseType<typeof client.api.v1.spaces.$get, 200>>().toEqualTypeOf<SpaceList>();
    expectTypeOf<InferResponseType<typeof client.api.v1.spaces.$post, 201>>().toEqualTypeOf<Space>();
    expectTypeOf<InferResponseType<(typeof client.api.v1.spaces)[":id"]["pages"]["$get"], 200>>().toEqualTypeOf<PageList>();
    expectTypeOf<InferResponseType<(typeof client.api.v1.spaces)[":id"]["pages"]["$post"], 201>>().toEqualTypeOf<Page>();
    expectTypeOf<InferResponseType<(typeof client.api.v1.pages)[":id"]["$get"], 200>>().toEqualTypeOf<Page>();
    expectTypeOf<InferResponseType<(typeof client.api.v1.pages)[":id"]["$patch"], 200>>().toEqualTypeOf<Page>();
    expectTypeOf<InferResponseType<typeof client.api.v1.search.$get, 200>>().toEqualTypeOf<SearchResult>();
  });
});

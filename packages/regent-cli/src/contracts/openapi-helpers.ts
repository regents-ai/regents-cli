type OperationFor<
  Paths,
  Path extends keyof Paths,
  Method extends keyof Paths[Path],
> = NonNullable<Paths[Path][Method]>;

type JsonContent<Value> = Value extends {
  content: { "application/json": infer Json };
}
  ? Json
  : never;

type SuccessResponseUnion<Responses> = Responses extends Record<string | number, unknown>
  ? | Responses[200]
    | Responses[201]
    | Responses[202]
    | Responses[203]
    | Responses[204]
    | Responses[206]
    | Responses["200"]
    | Responses["201"]
    | Responses["202"]
    | Responses["203"]
    | Responses["204"]
    | Responses["206"]
  : never;

export type JsonRequestBodyFor<
  Paths,
  Path extends keyof Paths,
  Method extends keyof Paths[Path],
> = OperationFor<Paths, Path, Method> extends {
  requestBody: infer RequestBody;
}
  ? JsonContent<RequestBody>
  : never;

export type JsonSuccessResponseFor<
  Paths,
  Path extends keyof Paths,
  Method extends keyof Paths[Path],
> = OperationFor<Paths, Path, Method> extends {
  responses: infer Responses;
}
  ? JsonContent<SuccessResponseUnion<Responses>>
  : never;

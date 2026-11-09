import { handleApi } from "../../lib/api-router";

type Env = {
  DB?: D1Database;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
  [key: string]: unknown;
};

export const onRequestGet: PagesFunction<Env> = async (context) => handleApi(context.request, context.env);
export const onRequestPost: PagesFunction<Env> = async (context) => handleApi(context.request, context.env);

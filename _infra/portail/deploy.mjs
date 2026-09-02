// Déploie l'API du portail partenaire Truck Stop Santé sur AWS (ca-central-1).
// Idempotent : crée les tables, le rôle, la Lambda et l'API HTTP s'ils manquent, sinon met le code à jour.
// Lancer depuis ce dossier :  node deploy.mjs     (les SDK AWS sont résolus depuis fuelpass-qc-demo/infra/node_modules)
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = "C:/Users/Carlos Faviel Font";
const req = createRequire(HOME + "/fuelpass-qc-demo/infra/node_modules/");
const { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand, AddPermissionCommand, waitUntilFunctionUpdatedV2, waitUntilFunctionActiveV2 } = req("@aws-sdk/client-lambda");
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, waitUntilTableExists } = req("@aws-sdk/client-dynamodb");
const { IAMClient, CreateRoleCommand, GetRoleCommand, AttachRolePolicyCommand, PutRolePolicyCommand } = req("@aws-sdk/client-iam");
const { ApiGatewayV2Client, CreateApiCommand, GetApisCommand } = req("@aws-sdk/client-apigatewayv2");

const ENV_FILE = HOME + "/.claude/.env";
const envText = readFileSync(ENV_FILE, "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
process.env.AWS_ACCESS_KEY_ID = env.HEALTHYPLAN_AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.HEALTHYPLAN_AWS_SECRET_ACCESS_KEY;

const REGION = "ca-central-1", ACCOUNT = "730335301855";
const FN = "tss-portail-api", ROLE = "tss-portail-lambda-role", API = "tss-portail-api";
const T_PARTNERS = "tss-portail-partenaires", T_MEMBERS = "tss-portail-membres";
const STRIPE_PRICE_ID = "price_1TuXuRKyyCqeElTHUDNlr3KS"; // Truck Stop Santé — Couverture santé, 8 $ CAD / mois / personne

let adminCode = env.TSS_PORTAIL_ADMIN_CODE;
if (!adminCode) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = randomBytes(10);
  adminCode = "TSS-ADMIN-" + [...b].map((x) => alphabet[x % alphabet.length]).join("");
  appendFileSync(ENV_FILE, `\n# --- Portail partenaire Truck Stop Santé (code admin de Carlos) ---\nTSS_PORTAIL_ADMIN_CODE=${adminCode}\n`);
  console.log("code admin généré et ajouté au .env");
}
if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY manquant dans .env");
// Alerte Telegram à Carlos (à inviter sur Spruce) : CARLOS_CLAUDE_BOT_TOKEN est vide dans le .env au 2026-09-02.
// Sans jeton, le portail fonctionne quand même ; il n'envoie simplement pas d'alerte.
const TG_TOKEN = env.CARLOS_CLAUDE_BOT_TOKEN || env.WATCHDOG_TELEGRAM_BOT_TOKEN || env.TSS_PORTAIL_TELEGRAM_TOKEN || "";
if (!TG_TOKEN) console.log("avertissement : aucun jeton Telegram (CARLOS_CLAUDE_BOT_TOKEN vide), alertes désactivées");
// Spruce : même chaîne d'authentification que spruce-invite-today.js (jamais dans un fichier déployé côté site)
const spruceSrc = readFileSync(HOME + "/spruce-invite-today.js", "utf8");
const SPRUCE_AUTH = (spruceSrc.match(/SPRUCE_AUTH = "([^"]+)"/) || [])[1] || "";
if (!SPRUCE_AUTH) throw new Error("SPRUCE_AUTH introuvable dans spruce-invite-today.js");

const lambda = new LambdaClient({ region: REGION });
const db = new DynamoDBClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const apigw = new ApiGatewayV2Client({ region: REGION });

/* 1. Tables */
async function ensureTable(name, keys) {
  try { await db.send(new DescribeTableCommand({ TableName: name })); console.log("table:", name, "existe"); return; } catch (e) { if (e.name !== "ResourceNotFoundException") throw e; }
  await db.send(new CreateTableCommand({
    TableName: name, BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: keys.map((k) => ({ AttributeName: k.name, AttributeType: "S" })),
    KeySchema: keys.map((k) => ({ AttributeName: k.name, KeyType: k.type })),
  }));
  await waitUntilTableExists({ client: db, maxWaitTime: 120 }, { TableName: name });
  console.log("table:", name, "créée");
}
await ensureTable(T_PARTNERS, [{ name: "code", type: "HASH" }]);
await ensureTable(T_MEMBERS, [{ name: "partner_code", type: "HASH" }, { name: "id", type: "RANGE" }]);

/* 2. Rôle */
let roleArn;
try { roleArn = (await iam.send(new GetRoleCommand({ RoleName: ROLE }))).Role.Arn; console.log("rôle: existe"); }
catch (e) {
  if (e.name !== "NoSuchEntityException") throw e;
  roleArn = (await iam.send(new CreateRoleCommand({
    RoleName: ROLE,
    AssumeRolePolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
    Description: "Portail partenaire Truck Stop Santé",
  }))).Role.Arn;
  await iam.send(new AttachRolePolicyCommand({ RoleName: ROLE, PolicyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" }));
  console.log("rôle: créé, propagation 12 s"); await new Promise((r) => setTimeout(r, 12000));
}
await iam.send(new PutRolePolicyCommand({
  RoleName: ROLE, PolicyName: "tss-portail-dynamodb",
  PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan"], Resource: [`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_PARTNERS}`, `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_MEMBERS}`] }] }),
}));

/* 3. Lambda */
const here = path.dirname(fileURLToPath(import.meta.url));
const zipPath = path.join(here, "lambda.zip");
execSync(`powershell -Command "Compress-Archive -Path '${path.join(here, "lambda")}/*' -DestinationPath '${zipPath}' -Force"`);
const zip = readFileSync(zipPath);
const Variables = {
  ADMIN_CODE: adminCode, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
  TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_CHAT_ID: "1889374592",
  SPRUCE_AUTH, AUTO_INVITE: env.TSS_PORTAIL_AUTO_INVITE || "oui",
    GOOGLE_CLIENT_ID: env.TSS_GOOGLE_CLIENT_ID || "",
    ADMIN_GOOGLE_EMAILS: env.TSS_ADMIN_GOOGLE_EMAILS || "cff@centremedicalfont.ca,info@centremedicalfont.ca",
};
let exists = true;
try { await lambda.send(new GetFunctionCommand({ FunctionName: FN })); } catch (e) { if (e.name !== "ResourceNotFoundException") throw e; exists = false; }
if (!exists) {
  for (let attempt = 1; ; attempt++) {
    try {
      await lambda.send(new CreateFunctionCommand({ FunctionName: FN, Runtime: "nodejs22.x", Role: roleArn, Handler: "index.handler", Code: { ZipFile: zip }, Timeout: 20, MemorySize: 256, Environment: { Variables }, Description: "Portail partenaire Truck Stop Santé" }));
      break;
    } catch (e) { if (e.name === "InvalidParameterValueException" && attempt < 6) { console.log("rôle pas encore prêt, nouvel essai…"); await new Promise((r) => setTimeout(r, 6000)); } else throw e; }
  }
  await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  console.log("lambda: créée");
} else {
  await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: FN, ZipFile: zip }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: FN, Environment: { Variables }, Timeout: 20, MemorySize: 256 }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  console.log("lambda: code + config mis à jour");
}

/* 4. API HTTP */
let api = (await apigw.send(new GetApisCommand({}))).Items?.find((a) => a.Name === API);
if (!api) {
  api = await apigw.send(new CreateApiCommand({
    Name: API, ProtocolType: "HTTP", Target: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}`,
    CorsConfiguration: { AllowOrigins: ["*"], AllowMethods: ["GET", "POST", "OPTIONS"], AllowHeaders: ["content-type"] },
  }));
  console.log("api: créée");
} else console.log("api: existe");
try {
  await lambda.send(new AddPermissionCommand({ FunctionName: FN, StatementId: "apigw-invoke", Action: "lambda:InvokeFunction", Principal: "apigateway.amazonaws.com", SourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT}:${api.ApiId}/*` }));
  console.log("permission: ajoutée");
} catch (e) { if (e.name !== "ResourceConflictException") throw e; }
console.log("API_URL=" + api.ApiEndpoint);

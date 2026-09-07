// Déploie l'API du portail partenaire Truck Stop Santé sur AWS (ca-central-1).
// Idempotent : crée les tables, le rôle, la Lambda et l'API HTTP s'ils manquent, sinon met le code à jour.
// Installer les dépendances de ce dossier et de lambda/, puis lancer node deploy.mjs.
import { readFileSync, appendFileSync, existsSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = "C:/Users/Carlos Faviel Font";
const req = createRequire(import.meta.url);
const { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand, AddPermissionCommand, ListEventSourceMappingsCommand, CreateEventSourceMappingCommand, UpdateEventSourceMappingCommand, waitUntilFunctionUpdatedV2, waitUntilFunctionActiveV2 } = req("@aws-sdk/client-lambda");
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, UpdateTableCommand, waitUntilTableExists } = req("@aws-sdk/client-dynamodb");
const { IAMClient, CreateRoleCommand, GetRoleCommand, AttachRolePolicyCommand, PutRolePolicyCommand } = req("@aws-sdk/client-iam");
const { ApiGatewayV2Client, CreateApiCommand, UpdateApiCommand, GetApisCommand } = req("@aws-sdk/client-apigatewayv2");
const { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } = req("@aws-sdk/client-sqs");

const ENV_FILE = HOME + "/.claude/.env";
const envText = readFileSync(ENV_FILE, "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
process.env.AWS_ACCESS_KEY_ID = env.HEALTHYPLAN_AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.HEALTHYPLAN_AWS_SECRET_ACCESS_KEY;

const REGION = "ca-central-1", ACCOUNT = "730335301855";
const FN = "tss-portail-api", ROLE = "tss-portail-lambda-role", API = "tss-portail-api";
const T_PARTNERS = "tss-portail-partenaires", T_MEMBERS = "tss-portail-membres", T_CONSENTS = "tss-portail-consents";
const STRIPE_PRICE_ID = "price_1TuXuRKyyCqeElTHUDNlr3KS"; // Truck Stop Santé — Couverture santé, 8 $ CAD / mois / personne

let adminCode = env.TSS_PORTAIL_ADMIN_CODE;
if (!adminCode) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = randomBytes(10);
  adminCode = "TSS-ADMIN-" + [...b].map((x) => alphabet[x % alphabet.length]).join("");
  appendFileSync(ENV_FILE, `\n# --- Portail partenaire Truck Stop Santé (code admin de Carlos) ---\nTSS_PORTAIL_ADMIN_CODE=${adminCode}\n`);
  console.log("code admin généré et ajouté au .env");
}
if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY manquant dans .env");
// Spruce : même chaîne d'authentification que spruce-invite-today.js (jamais dans un fichier déployé côté site)
const spruceSrc = readFileSync(HOME + "/spruce-invite-today.js", "utf8");
const SPRUCE_AUTH = (spruceSrc.match(/SPRUCE_AUTH = "([^"]+)"/) || [])[1] || "";
if (!SPRUCE_AUTH) throw new Error("SPRUCE_AUTH introuvable dans spruce-invite-today.js");
const SPRUCE_INTERNAL_ENDPOINT_ID = (spruceSrc.match(/INTERNAL_ENDPOINT_ID = "([^"]+)"/) || [])[1] || "";
if (!SPRUCE_INTERNAL_ENDPOINT_ID) throw new Error("INTERNAL_ENDPOINT_ID introuvable dans spruce-invite-today.js");

const lambda = new LambdaClient({ region: REGION });
const db = new DynamoDBClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const apigw = new ApiGatewayV2Client({ region: REGION });
const sqs = new SQSClient({ region: REGION });

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
await ensureTable(T_CONSENTS, [{ name: "pk", type: "HASH" }, { name: "sk", type: "RANGE" }]);
let consentTable = (await db.send(new DescribeTableCommand({ TableName: T_CONSENTS }))).Table;
if (!consentTable.StreamSpecification?.StreamEnabled || consentTable.StreamSpecification.StreamViewType !== "NEW_IMAGE") {
  await db.send(new UpdateTableCommand({ TableName: T_CONSENTS, StreamSpecification: { StreamEnabled: true, StreamViewType: "NEW_IMAGE" } }));
  await waitUntilTableExists({ client: db, maxWaitTime: 60 }, { TableName: T_CONSENTS });
  consentTable = (await db.send(new DescribeTableCommand({ TableName: T_CONSENTS }))).Table;
}
const consentStreamArn = consentTable.LatestStreamArn;
if (!consentStreamArn) throw new Error("Flux des consentements indisponible");
const failureQueue = await sqs.send(new CreateQueueCommand({ QueueName: "tss-portail-consent-failures", Attributes: { SqsManagedSseEnabled: "true", MessageRetentionPeriod: "1209600" } }));
const failureQueueArn = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: failureQueue.QueueUrl, AttributeNames: ["QueueArn"] }))).Attributes.QueueArn;

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
  PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: [
    { Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem"], Resource: [`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_PARTNERS}`, `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_MEMBERS}`] },
    { Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem"], Resource: [`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_CONSENTS}`] },
    { Effect: "Allow", Action: ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream"], Resource: [`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_CONSENTS}/stream/*`] },
    { Effect: "Allow", Action: ["dynamodb:ListStreams"], Resource: "*" },
    { Effect: "Allow", Action: ["sqs:SendMessage"], Resource: [failureQueueArn] }
  ] }),
}));

/* 3. Lambda */
const here = path.dirname(fileURLToPath(import.meta.url));
const zipPath = path.join(here, "lambda.zip");
copyFileSync(path.join(here, "../../portail/legal/2026-09-07.json"), path.join(here, "lambda/legal-documents.json"));
execSync(`powershell -Command "Compress-Archive -Path '${path.join(here, "lambda")}/*' -DestinationPath '${zipPath}' -Force"`);
const zip = readFileSync(zipPath);
const defaultVariables = {
  ADMIN_CODE: adminCode, STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
  SPRUCE_AUTH, SPRUCE_INTERNAL_ENDPOINT_ID, AUTO_INVITE: env.TSS_PORTAIL_AUTO_INVITE || "oui",
    GOOGLE_CLIENT_ID: env.TSS_GOOGLE_CLIENT_ID || "",
    STRIPE_WEBHOOK_SECRET: env.TSS_STRIPE_WEBHOOK_SECRET || "",
    ADMIN_GOOGLE_EMAILS: env.TSS_ADMIN_GOOGLE_EMAILS || "cff@centremedicalfont.ca,info@centremedicalfont.ca",
};
let exists = true;
let currentConfiguration;
try { currentConfiguration = (await lambda.send(new GetFunctionCommand({ FunctionName: FN }))).Configuration; } catch (e) { if (e.name !== "ResourceNotFoundException") throw e; exists = false; }
// Preserve the live billing, authentication and provider settings on updates.
const Variables = { ...defaultVariables, ...(currentConfiguration?.Environment?.Variables || {}), CONSENTS_TABLE: T_CONSENTS, CONSENT_STREAM_ARN: consentStreamArn };
for (const key of Object.keys(Variables)) if (/TELEGRAM|^TG_/i.test(key)) delete Variables[key];
if (!exists) {
  for (let attempt = 1; ; attempt++) {
    try {
      await lambda.send(new CreateFunctionCommand({ FunctionName: FN, Runtime: "nodejs22.x", Role: roleArn, Handler: "index.handler", Code: { ZipFile: zip }, Timeout: 28, MemorySize: 256, Environment: { Variables }, Description: "Portail partenaire Truck Stop Santé" }));
      break;
    } catch (e) { if (e.name === "InvalidParameterValueException" && attempt < 6) { console.log("rôle pas encore prêt, nouvel essai…"); await new Promise((r) => setTimeout(r, 6000)); } else throw e; }
  }
  await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  console.log("lambda: créée");
} else {
  await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: FN, ZipFile: zip }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: FN, Environment: { Variables }, Timeout: Math.max(28, currentConfiguration?.Timeout || 0), MemorySize: currentConfiguration?.MemorySize || 256 }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: FN });
  console.log("lambda: code + config mis à jour");
}

/* 4. Le dépôt au dossier continue même si le patient ferme la page. */
const mappingConfig = {
  FunctionName: FN, BatchSize: 1, Enabled: true,
  MaximumRetryAttempts: 3, MaximumRecordAgeInSeconds: 3600,
  BisectBatchOnFunctionError: true,
  DestinationConfig: { OnFailure: { Destination: failureQueueArn } },
  FilterCriteria: { Filters: [{ Pattern: JSON.stringify({
    eventName: ["INSERT", "MODIFY"],
    dynamodb: { NewImage: { queue_ready: { S: ["1"] }, sync_state: { S: ["pending", "uploaded", "verifying", "failed"] } } }
  }) }] }
};
const allMappings = [];
let mappingMarker;
do {
  const page = await lambda.send(new ListEventSourceMappingsCommand({ FunctionName: FN, Marker: mappingMarker }));
  allMappings.push(...(page.EventSourceMappings || []));
  mappingMarker = page.NextMarker;
} while (mappingMarker);
// A recreated stream has a new ARN. Retire only this table's obsolete worker;
// unrelated event sources for the function must remain untouched.
const consentStreamPrefix = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${T_CONSENTS}/stream/`;
for (const previous of allMappings) {
  if (previous.EventSourceArn?.startsWith(consentStreamPrefix) && previous.EventSourceArn !== consentStreamArn && !["Disabled", "Disabling"].includes(previous.State)) {
    await lambda.send(new UpdateEventSourceMappingCommand({ UUID: previous.UUID, Enabled: false }));
  }
}
const mappings = allMappings.filter((mapping) => mapping.EventSourceArn === consentStreamArn);
if (mappings.length > 1) throw new Error("Plusieurs traitements du même flux nécessitent une vérification");
if (mappings.length) await lambda.send(new UpdateEventSourceMappingCommand({ UUID: mappings[0].UUID, ...mappingConfig }));
else await lambda.send(new CreateEventSourceMappingCommand({ EventSourceArn: consentStreamArn, StartingPosition: "TRIM_HORIZON", ...mappingConfig }));
console.log("dépôt des consentements: traitement automatique configuré");

/* 5. API HTTP */
const corsConfiguration = { AllowOrigins: ["https://truckstopsante.com", "https://www.truckstopsante.com"], AllowMethods: ["GET", "POST", "OPTIONS"], AllowHeaders: ["content-type"] };
let api = (await apigw.send(new GetApisCommand({}))).Items?.find((a) => a.Name === API);
if (!api) {
  api = await apigw.send(new CreateApiCommand({
    Name: API, ProtocolType: "HTTP", Target: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}`,
    CorsConfiguration: corsConfiguration,
  }));
  console.log("api: créée");
} else {
  await apigw.send(new UpdateApiCommand({ ApiId: api.ApiId, CorsConfiguration: corsConfiguration }));
  console.log("api: configuration des origines mise à jour");
}
try {
  await lambda.send(new AddPermissionCommand({ FunctionName: FN, StatementId: "apigw-invoke", Action: "lambda:InvokeFunction", Principal: "apigateway.amazonaws.com", SourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT}:${api.ApiId}/*` }));
  console.log("permission: ajoutée");
} catch (e) { if (e.name !== "ResourceConflictException") throw e; }
console.log("API_URL=" + api.ApiEndpoint);

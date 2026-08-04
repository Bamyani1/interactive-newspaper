import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleAuth } from "google-auth-library";
import { loadLocalEnv } from "../lib/local-env";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const REQUIRED_SERVICES = [
  "aiplatform.googleapis.com",
  "documentai.googleapis.com",
] as const;

export interface GoogleRuntimeConfig {
  project: string;
  vertexLocation: string;
  documentAiLocation: string;
  documentAiProcessorId: string;
  expectedPrincipal: string | null;
}

export function validateGoogleRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleRuntimeConfig {
  const legacyKeys = ["GEMINI_API_KEY", "GOOGLE_API_KEY"].filter(
    (key) => Boolean(env[key]?.trim()),
  );
  if (legacyKeys.length > 0) {
    throw new Error(
      `ADC-only policy violation: remove ${legacyKeys.join(", ")} from the runtime environment.`,
    );
  }

  const project = env.GOOGLE_CLOUD_PROJECT?.trim();
  const vertexLocation = env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
  const documentAiLocation = env.DOCUMENT_AI_LOCATION?.trim() || "us";
  const documentAiProcessorId = env.DOCUMENT_AI_PROCESSOR_ID?.trim();
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is required.");
  if (vertexLocation !== "global") {
    throw new Error(
      `GOOGLE_CLOUD_LOCATION must be global for this project; received ${vertexLocation}.`,
    );
  }
  if (!documentAiProcessorId) {
    throw new Error("DOCUMENT_AI_PROCESSOR_ID is required.");
  }

  return {
    project,
    vertexLocation,
    documentAiLocation,
    documentAiProcessorId,
    expectedPrincipal: env.GOOGLE_ADC_EXPECTED_PRINCIPAL?.trim() || null,
  };
}

function finalSegment(value: string | undefined): string | null {
  if (!value) return null;
  const segments = value.split("/").filter(Boolean);
  return segments.at(-1) ?? null;
}

async function identifyPrincipal(
  auth: GoogleAuth,
  client: Awaited<ReturnType<GoogleAuth["getClient"]>>,
): Promise<string | null> {
  const credentials = await auth.getCredentials();
  if (credentials.client_email) return credentials.client_email;

  // Authorized-user ADC does not expose the account email in getCredentials().
  // Use the bearer token directly so google-auth-library does not attach the
  // quota-project header to this non-billable identity endpoint.
  const accessToken = await client.getAccessToken();
  if (!accessToken.token) return null;
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken.token}` } },
  );
  if (!response.ok) {
    throw new Error(`ADC identity lookup failed with HTTP ${response.status}.`);
  }
  const data = (await response.json()) as { email?: string };
  return data.email?.trim() || null;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = validateGoogleRuntimeEnv();
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  const client = await auth.getClient();
  const detectedProject = await auth.getProjectId();
  if (detectedProject !== config.project) {
    throw new Error(
      `ADC project mismatch: credentials resolve ${detectedProject}, application expects ${config.project}.`,
    );
  }

  const quotaProject = client.quotaProjectId || config.project;
  if (quotaProject !== config.project) {
    throw new Error(
      `ADC quota-project mismatch: credentials use ${quotaProject}, application expects ${config.project}.`,
    );
  }

  const principal = await identifyPrincipal(auth, client);
  if (!principal) throw new Error("ADC principal could not be identified.");
  if (
    config.expectedPrincipal &&
    principal.toLowerCase() !== config.expectedPrincipal.toLowerCase()
  ) {
    throw new Error(
      `ADC principal mismatch: authenticated as ${principal}, expected ${config.expectedPrincipal}.`,
    );
  }

  const serviceStates = await Promise.all(
    REQUIRED_SERVICES.map(async (service) => {
      const response = await client.request<{ name?: string; state?: string }>({
        url: `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(config.project)}/services/${service}`,
      });
      return [
        service,
        response.data.state ?? "UNKNOWN",
        response.data.name ?? "",
      ] as const;
    }),
  );
  const disabledServices = serviceStates.filter(([, state]) => state !== "ENABLED");
  if (disabledServices.length > 0) {
    throw new Error(
      `Required Google services are not enabled: ${disabledServices
        .map(([service, state]) => `${service} (${state})`)
        .join(", ")}.`,
    );
  }
  const projectNumber = serviceStates[0]?.[2]
    .match(/^projects\/([^/]+)\/services\//)?.[1];
  if (!projectNumber) {
    throw new Error("The Google Cloud project number could not be resolved from Service Usage.");
  }

  const processorResponse = await client.request<{
    name?: string;
    type?: string;
    state?: string;
    defaultProcessorVersion?: string;
  }>({
    url:
      `https://${config.documentAiLocation}-documentai.googleapis.com/v1/` +
      `projects/${encodeURIComponent(config.project)}/locations/${encodeURIComponent(config.documentAiLocation)}/` +
      `processors/${encodeURIComponent(config.documentAiProcessorId)}`,
  });
  const processorProject = processorResponse.data.name
    ?.match(/^projects\/([^/]+)\//)?.[1];
  const processorLocation = processorResponse.data.name
    ?.match(/\/locations\/([^/]+)\//)?.[1];
  if (
    processorProject !== projectNumber ||
    processorLocation !== config.documentAiLocation ||
    processorResponse.data.type !== "OCR_PROCESSOR" ||
    processorResponse.data.state !== "ENABLED"
  ) {
    throw new Error("The configured Document AI processor is not an enabled OCR processor in this project.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        auth: "application_default_credentials",
        principal,
        project: config.project,
        quotaProject,
        vertex: {
          location: config.vertexLocation,
          apiVersion: "v1",
          serviceEnabled: true,
        },
        documentAi: {
          location: config.documentAiLocation,
          serviceEnabled: true,
          processorType: processorResponse.data.type,
          processorState: processorResponse.data.state,
          defaultVersionConfigured: Boolean(
            finalSegment(processorResponse.data.defaultProcessorVersion),
          ),
        },
        apiKeysPresent: false,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}

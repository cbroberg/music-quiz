import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-not-for-production";

// ─── Client store (DCR) ───────────────────────────────────
// Clients are registered dynamically by claude.ai. We accept any
// client that shows up, so losing registrations on restart is fine —
// claude.ai will just re-register.

class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  async registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">) {
    const full = client as OAuthClientInformationFull;
    this.clients.set(full.client_id, full);
    return full;
  }
}

// ─── Auth code storage (short-lived, in-memory is fine) ────

interface CodeData {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  resource?: string;
  state?: string;
}

// ─── JWT token payloads ────────────────────────────────────

interface AccessTokenPayload {
  type: "access";
  clientId: string;
  scopes: string[];
  resource?: string;
}

interface RefreshTokenPayload {
  type: "refresh";
  clientId: string;
  scopes: string[];
  resource?: string;
}

// ─── OAuth provider (JWT-based, survives restarts) ─────────

export class AppleMusicOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();

  // Auth codes are very short-lived (< 60s), in-memory is fine
  private codes = new Map<string, CodeData>();
  // Revoked tokens (best-effort, lost on restart)
  private revoked = new Set<string>();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    // Personal server — auto-approve all authorization requests.
    const code = randomUUID();
    this.codes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes || [],
      resource: params.resource?.toString(),
      state: params.state,
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state) target.searchParams.set("state", params.state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error("Invalid authorization code");
    return data.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new Error("Invalid authorization code");
    if (data.clientId !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }
    this.codes.delete(authorizationCode);

    const scopes = data.scopes;
    const expiresIn = 7776000; // 90 days

    const accessToken = jwt.sign(
      { type: "access", clientId: client.client_id, scopes, resource: data.resource } satisfies AccessTokenPayload,
      JWT_SECRET,
      { expiresIn },
    );

    const refreshToken = jwt.sign(
      { type: "refresh", clientId: client.client_id, scopes, resource: data.resource } satisfies RefreshTokenPayload,
      JWT_SECRET,
      { expiresIn: "30d" },
    );

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET) as RefreshTokenPayload;
    } catch {
      throw new Error("Invalid or expired refresh token");
    }

    if (payload.type !== "refresh") throw new Error("Not a refresh token");
    if (payload.clientId !== client.client_id) throw new Error("Token not issued to this client");
    if (this.revoked.has(refreshToken)) throw new Error("Token revoked");

    const tokenScopes = scopes || payload.scopes;
    const expiresIn = 3600;

    const accessToken = jwt.sign(
      { type: "access", clientId: client.client_id, scopes: tokenScopes, resource: payload.resource } satisfies AccessTokenPayload,
      JWT_SECRET,
      { expiresIn },
    );

    const newRefreshToken = jwt.sign(
      { type: "refresh", clientId: client.client_id, scopes: tokenScopes, resource: payload.resource } satisfies RefreshTokenPayload,
      JWT_SECRET,
      { expiresIn: "30d" },
    );

    // Best-effort revocation of old refresh token
    this.revoked.add(refreshToken);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: tokenScopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (this.revoked.has(token)) throw new Error("Token revoked");

    let payload: AccessTokenPayload & { exp?: number };
    try {
      payload = jwt.verify(token, JWT_SECRET) as AccessTokenPayload & { exp?: number };
    } catch {
      throw new Error("Invalid or expired token");
    }

    if (payload.type !== "access") throw new Error("Not an access token");

    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.revoked.add(request.token);
  }
}

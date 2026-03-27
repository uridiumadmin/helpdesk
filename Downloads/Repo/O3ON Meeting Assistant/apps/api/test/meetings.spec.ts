import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

process.env.AUTH_MODE = "development";
process.env.DEV_AUTH_SECRET = "test-dev-secret";
process.env.DEV_AUTH_PASSWORD = "dev-password";
process.env.ALLOWED_ORIGINS = "http://localhost:8081";

describe("Meetings API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import("../src/app.module");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a meeting and returns it in the list", async () => {
    const sessionResponse = await request(app.getHttpServer())
      .post("/v1/auth/session")
      .send({ email: "owner@example.com", password: "dev-password" })
      .expect(201);

    const authHeaders = {
      authorization: `Bearer ${sessionResponse.body.accessToken}`
    };

    const createResponse = await request(app.getHttpServer())
      .post("/v1/meetings")
      .set(authHeaders)
      .send({
        title: "Weekly sync",
        language: "sr",
        startsAt: "2026-03-27T09:00:00.000Z",
        durationMinutes: 45,
        participantNames: ["Miloš", "Jelena"]
      })
      .expect(201);

    expect(createResponse.body.title).toBe("Weekly sync");
    expect(createResponse.body.participants).toHaveLength(2);

    const listResponse = await request(app.getHttpServer())
      .get("/v1/meetings")
      .set(authHeaders)
      .expect(200);

    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0].language).toBe("sr-RS");
  });

  it("accepts a meeting audio upload and marks it ready for processing", async () => {
    const sessionResponse = await request(app.getHttpServer())
      .post("/v1/auth/session")
      .send({ email: "owner@example.com", password: "dev-password" })
      .expect(201);

    const authHeaders = {
      authorization: `Bearer ${sessionResponse.body.accessToken}`
    };

    const meetingResponse = await request(app.getHttpServer())
      .post("/v1/meetings")
      .set(authHeaders)
      .send({ title: "Upload sync", participantNames: ["Ana"] })
      .expect(201);

    const uploadSession = await request(app.getHttpServer())
      .post(`/v1/meetings/${meetingResponse.body.id}/uploads/session`)
      .set(authHeaders)
      .send({ filename: "clip.wav" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/meetings/${meetingResponse.body.id}/uploads/${uploadSession.body.uploadId}/file`)
      .set(authHeaders)
      .attach("file", Buffer.from("fake-wave-bytes"), {
        filename: "clip.wav",
        contentType: "audio/wav"
      })
      .expect(201);

    const complete = await request(app.getHttpServer())
      .post(`/v1/meetings/${meetingResponse.body.id}/uploads/complete`)
      .set(authHeaders)
      .send({ uploadId: uploadSession.body.uploadId })
      .expect(201);

    expect(complete.body.processingJobId).toBeDefined();

    const status = await request(app.getHttpServer())
      .get(`/v1/meetings/${meetingResponse.body.id}/status`)
      .set(authHeaders)
      .expect(200);

    expect(status.body.processingReady).toBe(true);
    expect(status.body.uploadFileName).toBe("clip.wav");
  });

  it("rejects unsigned header-based impersonation in development mode", async () => {
    await request(app.getHttpServer())
      .get("/v1/meetings")
      .set({
        "x-org-id": "org-o3on",
        "x-user-id": "attacker",
        "x-user-email": "attacker@example.com"
      })
      .expect(401);
  });
});

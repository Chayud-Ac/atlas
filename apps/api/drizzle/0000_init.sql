CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"trace_id" text
);
--> statement-breakpoint
CREATE TABLE "app"."notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entra_tenant_id" uuid NOT NULL,
	"entra_object_id" uuid NOT NULL,
	"email" text,
	"display_name" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_entra_identity_key" UNIQUE("entra_tenant_id","entra_object_id")
);
--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notes" ADD CONSTRAINT "notes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "app"."audit_events" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notes_owner_created_idx" ON "app"."notes" USING btree ("owner_id","created_at" DESC NULLS LAST);
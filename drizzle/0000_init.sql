CREATE TABLE "users" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text,
	"profile_picture" text,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"provider" text DEFAULT 'local' NOT NULL,
	"provider_id" text,
	"email_verification_otp_hash" text,
	"email_verification_otp_expires_at" timestamp with time zone,
	"password_reset_otp_hash" text,
	"password_reset_otp_expires_at" timestamp with time zone,
	"last_otp_resent_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"custom_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" char(24) NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"original_amount" bigint,
	"original_currency" text,
	"base_currency_at_time" text,
	"exchange_rate" double precision,
	"rate_source" text,
	"exchange_rate_fetched_at" timestamp with time zone,
	"description" text,
	"category" text NOT NULL,
	"receipt_url" text,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"recurring_interval" text,
	"next_recurring_date" timestamp with time zone,
	"last_processed" timestamp with time zone,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"payment_method" text DEFAULT 'CASH' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" char(24) NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"total_budget" bigint NOT NULL,
	"category_limits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" char(24) NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6B7280' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_settings" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" char(24) NOT NULL,
	"frequency" text DEFAULT 'MONTHLY' NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"next_report_date" timestamp with time zone,
	"last_sent_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" char(24) NOT NULL,
	"period" text NOT NULL,
	"sent_date" timestamp with time zone NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"currency_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rate_cache" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" double precision NOT NULL,
	"rate_date" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supported_currency_cache" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_settings" ADD CONSTRAINT "report_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_provider_id_idx" ON "users" USING btree ("provider_id") WHERE provider_id is not null;--> statement-breakpoint
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_user_id_date_idx" ON "transactions" USING btree ("user_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_next_recurring_date_idx" ON "transactions" USING btree ("next_recurring_date") WHERE is_recurring = true;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_id_month_year_key" ON "budgets" USING btree ("user_id","month","year");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_id_name_key" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "report_settings_user_id_idx" ON "report_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_settings_next_report_date_idx" ON "report_settings" USING btree ("next_report_date") WHERE is_enabled = true;--> statement-breakpoint
CREATE INDEX "reports_user_id_created_at_idx" ON "reports" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exchange_rate_cache_pair_fetched_at_idx" ON "exchange_rate_cache" USING btree ("from_currency","to_currency","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_cache_pair_key" ON "exchange_rate_cache" USING btree ("from_currency","to_currency");--> statement-breakpoint
CREATE UNIQUE INDEX "supported_currency_cache_code_key" ON "supported_currency_cache" USING btree ("code");
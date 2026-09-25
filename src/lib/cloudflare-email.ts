import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import nodemailer, { type Transporter } from "nodemailer";
import {
  getEmailDisplayName,
  stripEmailDisplayName,
} from "./transactional-email.utils";
import type {
  EmailSenderOptions,
  TransactionalEmailContent,
} from "./transactional-email.types";
import { getRuntimeConfiguration } from "./runtime-env";

let cachedSmtpTransporter: Transporter | null = null;
let lastSmtpConfigKey = "";

function getSmtpTransporter(
  values: Record<string, string | undefined>
): Transporter | null {
  const host = values.SMTP_HOST;
  const user = values.SMTP_USER;
  const pass = values.SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(values.SMTP_PORT || 465);
  const secure = values.SMTP_SECURE === "true" || port === 465;
  const configKey = `${host}:${port}:${secure}:${user}:${pass}`;

  if (!cachedSmtpTransporter || lastSmtpConfigKey !== configKey) {
    cachedSmtpTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 5_000,
    });
    lastSmtpConfigKey = configKey;
  }
  return cachedSmtpTransporter;
}

export async function sendCloudflareEmailStrict(
  content: TransactionalEmailContent,
  sender?: EmailSenderOptions
) {
  const { values } = await getRuntimeConfiguration();

  let cfEnv: Record<string, any> = {};
  try {
    const cfContext = await getCloudflareContext({ async: true });
    cfEnv = cfContext.env || {};
  } catch {
    cfEnv = {};
  }

  const configuredFrom = values.EMAIL_FROM || values.SMTP_USER;
  if (!configuredFrom) {
    throw new Error(
      "Email sender is not configured. Please set EMAIL_FROM or SMTP_USER in your environment variables."
    );
  }

  const fromEmail = stripEmailDisplayName(configuredFrom);
  const fromName = getEmailDisplayName(configuredFrom);
  const senderName = sender?.name || fromName;
  const replyTo =
    sender?.replyTo ||
    values.EMAIL_REPLY_TO ||
    configuredFrom;

  const fromField = senderName
    ? `"${senderName}" <${fromEmail}>`
    : fromEmail;

  // 1. 如果通过环境变量配置了外部 SMTP（如阿里企业邮箱、腾讯企业邮等），优先使用 SMTP 发送
  const transporter = getSmtpTransporter(values);
  if (transporter) {
    await transporter.sendMail({
      from: fromField,
      to: content.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      replyTo: replyTo ? stripEmailDisplayName(replyTo) : undefined,
      headers: content.headers,
    });
    return true;
  }

  // 2. 否则若开启了 Cloudflare Email Routing 原生绑定（env.EMAIL），使用 Cloudflare Send Email 发送
  if (cfEnv.EMAIL) {
    await cfEnv.EMAIL.send({
      to: content.to,
      from: senderName ? { name: senderName, email: fromEmail } : fromEmail,
      ...(replyTo ? { replyTo } : {}),
      ...(content.headers ? { headers: content.headers } : {}),
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    return true;
  }

  throw new Error(
    "No email service available. In Cloudflare, either configure SMTP environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) or bind a Cloudflare Email service (EMAIL)."
  );
}

export async function sendCloudflareEmail(
  content: TransactionalEmailContent,
  sender?: EmailSenderOptions
) {
  try {
    await sendCloudflareEmailStrict(content, sender);
    return true;
  } catch (error) {
    console.error("Transactional email delivery failed", error);
    return false;
  }
}

import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  getEmailDisplayName,
  stripEmailDisplayName,
} from "./transactional-email.utils";
import type {
  EmailSenderOptions,
  TransactionalEmailContent,
} from "./transactional-email.types";
import { getRuntimeConfiguration } from "./runtime-env";

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

  const resendApiKey = values.RESEND_API_KEY || process.env.RESEND_API_KEY;

  // 1. 如果配置了 RESEND_API_KEY，走 Resend 官方 HTTPS REST API 发送（支持全平台，无端口限制）
  if (resendApiKey) {
    const configuredFrom =
      values.EMAIL_FROM ||
      process.env.EMAIL_FROM ||
      "Paymug <onboarding@resend.dev>";
    const fromEmail = stripEmailDisplayName(configuredFrom);
    const fromName = getEmailDisplayName(configuredFrom);
    const senderName = sender?.name || fromName;
    const replyTo =
      sender?.replyTo ||
      values.EMAIL_REPLY_TO ||
      process.env.EMAIL_REPLY_TO ||
      configuredFrom;

    const fromField = senderName
      ? `"${senderName}" <${fromEmail}>`
      : fromEmail;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromField,
        to: Array.isArray(content.to) ? content.to : [content.to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        reply_to: replyTo ? stripEmailDisplayName(replyTo) : undefined,
        headers: content.headers,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend email delivery failed (${response.status}): ${errorText}`);
    }

    return true;
  }

  // 2. 否则若开启了 Cloudflare 原生 Email 绑定，使用 env.EMAIL 发送
  const configuredFrom = cfEnv.EMAIL_FROM || process.env.EMAIL_FROM;
  if (cfEnv.EMAIL && configuredFrom) {
    const fromEmail = stripEmailDisplayName(configuredFrom);
    const fromName = getEmailDisplayName(configuredFrom);
    const senderName = sender?.name || fromName;
    const replyTo =
      sender?.replyTo ||
      cfEnv.EMAIL_REPLY_TO ||
      process.env.EMAIL_REPLY_TO ||
      configuredFrom;

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
    "No email service configured. Please provide RESEND_API_KEY in your environment variables or bind a Cloudflare Email service."
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

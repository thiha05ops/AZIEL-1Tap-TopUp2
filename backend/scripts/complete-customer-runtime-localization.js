#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "../..");
const localeFiles = ["en", "my", "th"];
const ctx = { window: { AZIEL_LANG: {} } };
for (const locale of localeFiles) vm.runInNewContext(fs.readFileSync(path.join(root, `frontend/lang/${locale}.js`), "utf8"), ctx);
vm.runInNewContext(fs.readFileSync(path.join(root, "frontend/lang/storefront-static.js"), "utf8"), ctx);
const dictionaries = ctx.window.AZIEL_LANG;
const additions = { en: {}, my: {}, th: {} };
const missing = [];
const authored = {
  my: {
    "wallet.loadingPaymentMethods": "ငွေပေးချေနည်းများကို ဖွင့်နေသည်...", "wallet.paymentMethodsFailed": "ငွေပေးချေနည်းများကို ဖွင့်မရပါ။", "wallet.noPaymentMethods": "Wallet ဖြည့်ရန် ငွေပေးချေနည်း မရှိသေးပါ။", "wallet.paymentBadge.auto": "အလိုအလျောက်", "wallet.paymentBadge.bankApp": "ဘဏ် App", "wallet.paymentBadge.receipt": "ပြေစာ", "wallet.transferInstructions": "သတ်မှတ်ထားသော ပမာဏအတိအကျကို လွှဲပြီး ပြေစာကို တင်ပါ။", "wallet.receiptFailed": "ပြေစာတင်ခြင်း မအောင်မြင်ပါ။ ထပ်စမ်းပါ။", "wallet.receiptSubmitted": "စစ်ဆေးရန် ငွေပေးချေပြေစာကို တင်ပြီးပါပြီ။", "wallet.appOpenFailed": "ဤငွေပေးချေ App ကို အလိုအလျောက် မဖွင့်နိုင်ပါ။ ကိုယ်တိုင်ဖွင့်ပါ။", "wallet.openingApp": "ငွေပေးချေ App ကို ဖွင့်နေသည်... ငွေလွှဲပြီးနောက် ဤနေရာသို့ ပြန်လာ၍ ပြေစာတင်ပါ။", "common.copied": "ကူးယူပြီးပါပြီ။", "common.copyFailed": "ကူးယူမရပါ။ ကိုယ်တိုင်ကူးယူပါ။", "wallet.sessionExpired": "ဤငွေပေးချေမှု session သက်တမ်းကုန်ပါပြီ။ Wallet ဖြည့်ခြင်းကို ထပ်စပါ။", "wallet.receiptAwaitingAdmin": "ငွေပေးချေပြေစာ တင်ပြီးပါပြီ။ Admin စစ်ဆေးမှုကို စောင့်ပါ။",
    "search.mobileGames": "မိုဘိုင်းဂိမ်းများ", "search.category": "အမျိုးအစား", "search.mobileGamesHelp": "မိုဘိုင်းဂိမ်း Top-up များ ရှာဖွေရန်", "search.pcGamesHelp": "PC ဂိမ်းဝန်ဆောင်မှုများ ရှာဖွေရန်", "search.giftCardsHelp": "Gift Card များ ရှာဖွေရန်", "search.socialTopUpHelp": "Telegram နှင့် လူမှုကွန်ရက်ဝန်ဆောင်မှုများ", "search.supportHelp": "အော်ဒါ၊ ငွေပေးချေမှု၊ Wallet နှင့် အကောင့်ပြဿနာများအတွက် အကူအညီရယူရန်", "search.faqHelp": "မေးလေ့ရှိသော မေးခွန်းနှင့် အဖြေများ", "search.contactHelp": "အထွေထွေနှင့် စီးပွားရေးဆိုင်ရာ စုံစမ်းမေးမြန်းမှုများ", "search.title": "AZIEL တွင် ရှာဖွေရန်", "search.keyboardHelp": "ရလဒ်များအတွင်း ရွှေ့ရန် မြားခလုတ်များ၊ ဖွင့်ရန် Enter နှင့် ရှာဖွေမှုကို ပိတ်ရန် Escape ကို အသုံးပြုပါ။", "search.placeholder": "ဂိမ်းများ၊ Gift Card များ ရှာဖွေရန်...", "search.clear": "ရှာဖွေမှုကို ရှင်းရန်", "search.close": "ရှာဖွေမှုကို ပိတ်ရန်", "search.results": "ရှာဖွေမှုရလဒ်များ", "search.catalogPartial": "Catalog ရှာဖွေမှုအချို့ကို ယာယီအသုံးမပြုနိုင်ပါ။", "search.promotion": "ပရိုမိုးရှင်း", "search.promotions": "ပရိုမိုးရှင်းများ", "search.activeOffer": "လက်ရှိကမ်းလှမ်းချက်", "search.resultsShort": "ရလဒ်များ", "search.recent": "မကြာသေးမီက", "search.suggestions": "အကြံပြုချက်များ", "search.searching": "ရှာဖွေနေသည်", "search.noResults": "ရလဒ်မတွေ့ပါ", "search.trySearching": "ဤအရာများကို ရှာကြည့်ပါ:", "search.placeholderCompact": "ဂိမ်းများ ရှာဖွေရန်...",
    footerCopyright: "© 2026 AZIEL 1Tap Shop.", tagline: "1 TAP. TOP UP. DONE.",
    enterAovPlayerId: "Arena of Valor Player ID ထည့်ပါ", enterFreefirePlayerId: "Free Fire Player ID ထည့်ပါ", enterGenshinUid: "Genshin UID ထည့်ပါ", enterHokPlayerId: "Honor of Kings Player ID ထည့်ပါ", enterPubgPlayerId: "PUBG Mobile Player ID ထည့်ပါ", enterRobloxUserId: "Roblox အသုံးပြုသူအမည် သို့မဟုတ် User ID ထည့်ပါ", enterTelegramAccount: "Telegram အသုံးပြုသူအမည် သို့မဟုတ် ဖုန်းနံပါတ် ထည့်ပါ",
    "campaign.closePopup": "ကမ်ပိန်းပေါ့ပ်အပ်ကို ပိတ်ရန်", "campaign.noticeLabel": "ကမ်ပိန်း အသိပေးချက်", "campaign.dismissProduct": "ထုတ်ကုန်ကမ်ပိန်း အသိပေးချက်ကို ပိတ်ရန်", "campaign.dismissTop": "ထိပ်တန်းကမ်ပိန်း အသိပေးချက်ကို ပိတ်ရန်",
    "home.showBanner": "ဘန်နာ {number} ကို ပြရန်", "home.banners": "ပင်မစာမျက်နှာ ဘန်နာများ", "home.previousBanner": "ယခင်ဘန်နာကို ပြရန်", "home.nextBanner": "နောက်ဘန်နာကို ပြရန်", popularGameCards: "လူကြိုက်များသော ဂိမ်းကတ်များ", pcGames: "လူကြိုက်များသော PC ဂိမ်းများ", newGameCards: "ဂိမ်းကတ်အသစ်များ", digitalServices: "ဒစ်ဂျစ်တယ်ဝန်ဆောင်မှုများ", newGames: "ဂိမ်းအသစ်များ", show: "ပြရန်",
    payment_transfer_completed: "ငွေလွှဲပြီးပါပြီ", payment_upload_receipt_next: "ငွေလွှဲပြီးပါပြီ။ စစ်ဆေးရန် ပြေစာကို တင်ပါ။", "payment.activeConflict": "အသုံးပြုနေသော ငွေပေးချေမှုရှိပြီးဖြစ်သည်။ နည်းလမ်းမပြောင်းမီ ၎င်းကို ဆက်လုပ်ပါ။", "payment.continueWith": "{method} ဖြင့် ဆက်လုပ်ပါ။", "payment.activeReady": "အသုံးပြုနေသော ငွေပေးချေမှုကို ဆက်လုပ်နိုင်ပါပြီ။", "order.statusLabel": "အော်ဒါအခြေအနေ", "payment.success.title": "ငွေပေးချေမှု အောင်မြင်ပါသည်", "payment.submitted.title": "ငွေပေးချေမှု တင်ပြီးပါပြီ", "payment.success.processing": "သင့်အော်ဒါကို ဆောင်ရွက်နေပါသည်။", "payment.submitted.awaiting": "သင့်ပြေစာကို စစ်ဆေးရန် စောင့်ဆိုင်းနေပါသည်။", "payment.redirectCountdown": "{seconds} စက္ကန့်အတွင်း အော်ဒါခြေရာခံခြင်းသို့ သွားပါမည်", "payment.trackOrderNow": "အော်ဒါကို ယခုခြေရာခံရန်", "payment.backHome": "ပင်မစာမျက်နှာသို့", "payment.state.pendingVerification": "စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်", "payment.resume": "ငွေပေးချေမှု ဆက်လုပ်ရန်", "payment.sessionUnavailable": "ငွေပေးချေမှု session မရနိုင်ပါ", "payment.sessionUnavailableHelp": "အသုံးပြုနေသော ငွေပေးချေမှုကို ဆက်လုပ်ရန် သို့မဟုတ် အခြေအနေကြည့်ရန် My Orders ကို ဖွင့်ပါ။", "payment.viewOrders": "ကျွန်ုပ်၏အော်ဒါများကို ကြည့်ရန်",
    "checkout.packageUnavailable": "ဤပက်ကေ့ချ် မရနိုင်တော့ပါ။ ထုတ်ကုန်စာမျက်နှာသို့ ပြန်၍ ထပ်ရွေးပါ။", "checkout.priceChanged": "ပက်ကေ့ချ်စျေးနှုန်း ပြောင်းလဲသွားပါသည်။ နောက်ဆုံးစုစုပေါင်းကို ကြည့်ရန် ထုတ်ကုန်သို့ ပြန်ပါ။", "checkout.promoNotApplied": "မသုံးထားပါ", "checkout.verifyingReview": "ပက်ကေ့ချ်၊ ပရိုမိုးရှင်းနှင့် စုစုပေါင်းကို AZIEL နှင့် စစ်ဆေးနေသည်...", "checkout.reviewFailed": "Checkout အတည်ပြုချက်ကို မစစ်ဆေးနိုင်ပါ။", "checkout.totalReady": "အတည်ပြုထားသော စုစုပေါင်း အဆင်သင့်ဖြစ်ပါပြီ။", "checkout.couldNotContinue": "Checkout ကို ဆက်မလုပ်နိုင်ပါ။",
    "product.loadingPackages": "ရနိုင်သော ပက်ကေ့ချ်များကို ဖွင့်နေသည်", "product.trustLine": "မြန်ဆန်စွာပို့ဆောင်မှု • လုံခြုံသော Checkout • အော်ဒါခြေရာခံခြင်း", "product.price": "စျေးနှုန်း", "checkout.paymentProtected": "လုံခြုံသော Checkout • သင့်ငွေပေးချေမှုကို ကာကွယ်ထားသည်", "product.checkAccountFields": "Checkout မလုပ်မီ သင့် {fields} ကို သေချာစစ်ဆေးပါ။", "common.and": " နှင့် ", "product.howTo.accountFields": "သင့် {fields} ကို ထည့်ပါ။", "product.howTo.account": "အထက်တွင် တောင်းဆိုထားသော အကောင့်အချက်အလက်ကို ထည့်ပါ။", "product.howTo.package": "လိုချင်သော ပက်ကေ့ချ်ကို ရွေးပါ။", "product.howTo.checkout": "Checkout သို့ ဆက်သွားပြီး ငွေပေးချေနည်းကို ရွေးပါ။", "product.howTo.complete": "ငွေပေးချေပြီး အော်ဒါအခြေအနေကို ခြေရာခံပါ။",
    "tracking.orderDetail": "အော်ဒါအသေးစိတ်", "tracking.orderDetailHelp": "ဤအော်ဒါ၏ အတည်ပြုထားသော ငွေပေးချေမှုနှင့် ဖြည့်ဆည်းမှုအခြေအနေ။", paymentTime: "ငွေပေးချေချိန်", trackingAwaitingManualVerification: "လူကိုယ်တိုင် စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်", trackingPaymentSubmittedText: "ငွေပေးချေမှု တင်ပြီးပါပြီ။ စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်။", trackingPaymentSubmitted: "ငွေပေးချေမှု တင်ပြီးပါပြီ", refundUnavailable: "ငွေပြန်အမ်းခြင်း မရနိုင်ပါ", refundBlockedNotPaid: "ငွေပေးပြီးသော အော်ဒါများကိုသာ ပြန်အမ်းနိုင်ပါသည်။", refundBlockedCredited: "ဤအော်ဒါကို ပြန်အမ်းပြီးပါပြီ။", refundBlockedRequested: "ငွေပြန်အမ်းရန် တောင်းဆိုပြီးပါပြီ။", refundBlockedActiveFulfillment: "ဤအော်ဒါ၏ ဖြည့်ဆည်းမှု ဆက်လက်လုပ်ဆောင်နေသည်။", refundBlockedFulfilled: "ပြီးစီးသော အော်ဒါများကို ပြန်မအမ်းနိုင်ပါ။", refundBlockedNotEligible: "ဤအော်ဒါသည် ငွေပြန်အမ်းရန် အကျုံးမဝင်ပါ။", statusPendingVerification: "စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်", walletBalanceAfter: "လက်ကျန်", walletReversal: "Wallet ပြန်လည်ပြင်ဆင်မှု", walletAdjustment: "Wallet ချိန်ညှိမှု", creatingPayment: "ငွေပေးချေမှု ဖန်တီးနေသည်..."
  },
  th: {
    "wallet.loadingPaymentMethods": "กำลังโหลดวิธีชำระเงิน...", "wallet.paymentMethodsFailed": "โหลดวิธีชำระเงินไม่สำเร็จ", "wallet.noPaymentMethods": "ไม่มีวิธีชำระเงินสำหรับเติม Wallet", "wallet.paymentBadge.auto": "อัตโนมัติ", "wallet.paymentBadge.bankApp": "แอปธนาคาร", "wallet.paymentBadge.receipt": "ใบเสร็จ", "wallet.transferInstructions": "โอนยอดเงินให้ตรงตามที่กำหนด แล้วอัปโหลดใบเสร็จ", "wallet.receiptFailed": "ส่งใบเสร็จไม่สำเร็จ โปรดลองอีกครั้ง", "wallet.receiptSubmitted": "ส่งใบเสร็จเพื่อการตรวจสอบแล้ว", "wallet.appOpenFailed": "ไม่สามารถเปิดแอปชำระเงินอัตโนมัติได้ โปรดเปิดด้วยตนเอง", "wallet.openingApp": "กำลังเปิดแอปชำระเงิน... หลังโอนแล้วให้กลับมาอัปโหลดใบเสร็จที่นี่", "common.copied": "คัดลอกแล้ว", "common.copyFailed": "คัดลอกไม่สำเร็จ โปรดคัดลอกด้วยตนเอง", "wallet.sessionExpired": "เซสชันการชำระเงินหมดอายุ โปรดเริ่มเติม Wallet ใหม่", "wallet.receiptAwaitingAdmin": "ส่งใบเสร็จแล้ว โปรดรอเจ้าหน้าที่ตรวจสอบ",
    "search.mobileGames": "เกมมือถือ", "search.category": "หมวดหมู่", "search.mobileGamesHelp": "เลือกดูบริการเติมเงินเกมมือถือ", "search.pcGamesHelp": "เลือกดูบริการเกม PC", "search.giftCardsHelp": "เลือกดูบัตรของขวัญ", "search.socialTopUpHelp": "Telegram และบริการโซเชียล", "search.supportHelp": "รับความช่วยเหลือเกี่ยวกับคำสั่งซื้อ การชำระเงิน Wallet และบัญชี", "search.faqHelp": "คำถามและคำตอบที่พบบ่อย", "search.contactHelp": "สอบถามข้อมูลทั่วไปและธุรกิจ", "search.title": "ค้นหาใน AZIEL", "search.keyboardHelp": "ใช้ปุ่มลูกศรเพื่อเลื่อนดูผลลัพธ์ กด Enter เพื่อเปิด และกด Escape เพื่อปิดการค้นหา", "search.placeholder": "ค้นหาเกม บัตรของขวัญ...", "search.clear": "ล้างการค้นหา", "search.close": "ปิดการค้นหา", "search.results": "ผลการค้นหา", "search.catalogPartial": "การค้นหา Catalog บางส่วนไม่พร้อมใช้งานชั่วคราว", "search.promotion": "โปรโมชัน", "search.promotions": "โปรโมชัน", "search.activeOffer": "ข้อเสนอที่ใช้งานอยู่", "search.resultsShort": "ผลลัพธ์", "search.recent": "ล่าสุด", "search.suggestions": "คำแนะนำ", "search.searching": "กำลังค้นหา", "search.noResults": "ไม่พบผลลัพธ์", "search.trySearching": "ลองค้นหา:", "search.placeholderCompact": "ค้นหาเกม...",
    footerCopyright: "© 2026 AZIEL 1Tap Shop.", tagline: "1 TAP. TOP UP. DONE.",
    enterAovPlayerId: "กรอก Player ID ของ Arena of Valor", enterFreefirePlayerId: "กรอก Player ID ของ Free Fire", enterGenshinUid: "กรอก UID ของ Genshin", enterHokPlayerId: "กรอก Player ID ของ Honor of Kings", enterPubgPlayerId: "กรอก Player ID ของ PUBG Mobile", enterRobloxUserId: "กรอกชื่อผู้ใช้หรือ User ID ของ Roblox", enterTelegramAccount: "กรอกชื่อผู้ใช้ Telegram หรือหมายเลขโทรศัพท์",
    "campaign.closePopup": "ปิดป๊อปอัปแคมเปญ", "campaign.noticeLabel": "ประกาศแคมเปญ", "campaign.dismissProduct": "ปิดประกาศแคมเปญสินค้า", "campaign.dismissTop": "ปิดประกาศแคมเปญด้านบน", "home.showBanner": "แสดงแบนเนอร์ {number}", "home.banners": "แบนเนอร์หน้าแรก", "home.previousBanner": "แสดงแบนเนอร์ก่อนหน้า", "home.nextBanner": "แสดงแบนเนอร์ถัดไป", popularGameCards: "บัตรเกมยอดนิยม", pcGames: "เกม PC ยอดนิยม", newGameCards: "บัตรเกมใหม่", digitalServices: "บริการดิจิทัล", newGames: "เกมใหม่", show: "แสดง",
    payment_transfer_completed: "ฉันโอนเงินแล้ว", payment_upload_receipt_next: "โอนเงินแล้ว โปรดอัปโหลดใบเสร็จเพื่อการตรวจสอบ", "payment.activeConflict": "มีรายการชำระเงินที่ใช้งานอยู่ โปรดดำเนินการต่อก่อนเปลี่ยนวิธีชำระเงิน", "payment.continueWith": "ดำเนินการต่อด้วย {method}", "payment.activeReady": "รายการชำระเงินพร้อมให้ดำเนินการต่อ", "order.statusLabel": "สถานะคำสั่งซื้อ", "payment.success.title": "ชำระเงินสำเร็จ", "payment.submitted.title": "ส่งข้อมูลการชำระเงินแล้ว", "payment.success.processing": "กำลังดำเนินการคำสั่งซื้อของคุณ", "payment.submitted.awaiting": "ใบเสร็จของคุณกำลังรอการตรวจสอบ", "payment.redirectCountdown": "กำลังไปยังการติดตามคำสั่งซื้อใน {seconds} วินาที", "payment.trackOrderNow": "ติดตามคำสั่งซื้อตอนนี้", "payment.backHome": "กลับหน้าแรก", "payment.state.pendingVerification": "รอการตรวจสอบ", "payment.resume": "ดำเนินการชำระเงินต่อ", "payment.sessionUnavailable": "ไม่พบเซสชันการชำระเงิน", "payment.sessionUnavailableHelp": "เปิดคำสั่งซื้อของฉันเพื่อดำเนินการชำระเงินต่อหรือตรวจสอบสถานะ", "payment.viewOrders": "ดูคำสั่งซื้อของฉัน",
    "checkout.packageUnavailable": "แพ็กเกจนี้ไม่พร้อมใช้งานแล้ว โปรดกลับไปเลือกใหม่ที่หน้าสินค้า", "checkout.priceChanged": "ราคาแพ็กเกจเปลี่ยนแปลง โปรดกลับไปตรวจสอบยอดล่าสุดที่หน้าสินค้า", "checkout.promoNotApplied": "ไม่ได้ใช้", "checkout.verifyingReview": "กำลังตรวจสอบแพ็กเกจ โปรโมชัน และยอดรวมกับ AZIEL...", "checkout.reviewFailed": "ไม่สามารถตรวจสอบข้อมูล Checkout ได้", "checkout.totalReady": "ยอดรวมที่ยืนยันแล้วพร้อมใช้งาน", "checkout.couldNotContinue": "ไม่สามารถดำเนินการ Checkout ต่อได้",
    "product.loadingPackages": "กำลังโหลดแพ็กเกจที่พร้อมใช้งาน", "product.trustLine": "จัดส่งรวดเร็ว • Checkout ปลอดภัย • ติดตามคำสั่งซื้อ", "product.price": "ราคา", "checkout.paymentProtected": "Checkout ปลอดภัย • การชำระเงินของคุณได้รับการคุ้มครอง", "product.checkAccountFields": "ตรวจสอบ {fields} ให้ถูกต้องก่อน Checkout", "common.and": " และ ", "product.howTo.accountFields": "กรอก {fields}", "product.howTo.account": "กรอกข้อมูลบัญชีที่ขอไว้ด้านบน", "product.howTo.package": "เลือกแพ็กเกจที่ต้องการ", "product.howTo.checkout": "ไปยัง Checkout และเลือกวิธีชำระเงิน", "product.howTo.complete": "ชำระเงินให้เสร็จและติดตามสถานะคำสั่งซื้อ",
    "tracking.orderDetail": "รายละเอียดคำสั่งซื้อ", "tracking.orderDetailHelp": "สถานะการชำระเงินและการดำเนินการที่ยืนยันแล้วของคำสั่งซื้อนี้", paymentTime: "เวลาชำระเงิน", trackingAwaitingManualVerification: "รอการตรวจสอบด้วยเจ้าหน้าที่", trackingPaymentSubmittedText: "ส่งข้อมูลการชำระเงินแล้ว กำลังรอการตรวจสอบ", trackingPaymentSubmitted: "ส่งข้อมูลการชำระเงินแล้ว", refundUnavailable: "ไม่สามารถคืนเงินได้", refundBlockedNotPaid: "คืนเงินได้เฉพาะคำสั่งซื้อที่ชำระแล้ว", refundBlockedCredited: "คำสั่งซื้อนี้ได้รับการคืนเงินแล้ว", refundBlockedRequested: "ส่งคำขอคืนเงินแล้ว", refundBlockedActiveFulfillment: "คำสั่งซื้อนี้กำลังดำเนินการอยู่", refundBlockedFulfilled: "ไม่สามารถคืนเงินคำสั่งซื้อที่เสร็จสมบูรณ์แล้ว", refundBlockedNotEligible: "คำสั่งซื้อนี้ไม่เข้าเกณฑ์การคืนเงิน", statusPendingVerification: "รอการตรวจสอบ", walletBalanceAfter: "ยอดคงเหลือ", walletReversal: "การย้อนรายการ Wallet", walletAdjustment: "การปรับยอด Wallet", creatingPayment: "กำลังสร้างการชำระเงิน..."
  }
};

function translated(locale, english) {
  const en = dictionaries.en || {};
  const key = Object.keys(en).find(candidate => String(en[candidate]).replace(/\s+/g, " ").trim() === english);
  return key && dictionaries[locale]?.[key] ? dictionaries[locale][key] : "";
}
function add(key, english) {
  if (!key || dictionaries.en?.[key] || additions.en[key]) return;
  const clean = String(english || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (!clean) return;
  additions.en[key] = clean;
  for (const locale of ["my", "th"]) {
    additions[locale][key] = authored[locale]?.[key] || translated(locale, clean);
    if (!additions[locale][key]) missing.push({ key, locale, english: clean });
  }
}

for (const file of fs.readdirSync(path.join(root, "frontend")).filter(name => name.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(root, "frontend", file), "utf8");
  for (const match of html.matchAll(/<([a-z0-9-]+)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/gi)) add(match[3], match[4]);
  const attrPairs = [
    ["placeholder", "data-i18n-placeholder"], ["title", "data-i18n-title"],
    ["aria-label", "data-i18n-aria-label"], ["aria-description", "data-i18n-aria-description"], ["alt", "data-i18n-alt"]
  ];
  for (const [attribute, marker] of attrPairs) {
    const pattern = new RegExp(`<[^>]*\\b${attribute}="([^"]*)"[^>]*\\b${marker}="([^"]+)"[^>]*>`, "gi");
    for (const match of html.matchAll(pattern)) add(match[2], match[1]);
    const reverse = new RegExp(`<[^>]*\\b${marker}="([^"]+)"[^>]*\\b${attribute}="([^"]*)"[^>]*>`, "gi");
    for (const match of html.matchAll(reverse)) add(match[1], match[2]);
  }
}

function collectJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(target);
    else if (entry.name.endsWith(".js") && !entry.name.startsWith("admin-")) {
      const source = fs.readFileSync(target, "utf8");
      const pattern = /(?:\b(?:t|tr|wt|authT|supportT|rt)\s*\(\s*|AZIEL_I18N\?\.t\?\.\(\s*)["']([A-Za-z0-9_.-]+)["']\s*,\s*["']([^"']*)["']/g;
      for (const match of source.matchAll(pattern)) add(match[1], match[2]);
    }
  }
}
collectJs(path.join(root, "frontend/js"));

fs.writeFileSync("/private/tmp/aziel-g21-runtime-additions.json", JSON.stringify({ additions, missing }, null, 2));
if (process.argv.includes("--apply")) {
  const target = path.join(root, "frontend/lang/storefront-static.js");
  let source = fs.readFileSync(target, "utf8");
  const blocks = localeFiles.map(locale => `  Object.assign(window.AZIEL_LANG.${locale}, ${JSON.stringify(additions[locale], null, 2).replace(/^/gm, "  ")});`).join("\n");
  source = source.replace(/\n\}\)\(\);\s*$/, `\n${blocks}\n})();\n`);
  fs.writeFileSync(target, source);
}
console.log(JSON.stringify({ counts: Object.fromEntries(localeFiles.map(locale => [locale, Object.keys(additions[locale]).length])), missing }, null, 2));

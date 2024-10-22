# BTCPay Server integration for Wix

This guide will show you how you can enable Bitcoin payments using BTCPay Server on your Wix store. At the time of writing it is not possible to package this into a Wix app, so you will need to follow the steps below and copy and paste the code into your Wix editor.

## Requirements
- You have a [Wix](https://wix.com) account and online store up and running
- You have a BTCPay Server version 1.10.0 or later, either [self-hosted](https://docs.btcpayserver.org/Deployment/) or [hosted by a third-party](https://docs.btcpayserver.org/Deployment/ThirdPartyHosting/). 
- BTCPay needs to be reachable from the internet via a domain, e.g. https://mainnet.demo.btcpayserver.org
- [You've a registered account on the instance](https://docs.btcpayserver.org/RegisterAccount/)
- [You've a BTCPay store on the instance](https://docs.btcpayserver.org/CreateStore/)
- [You've a wallet connected to your store](https://docs.btcpayserver.org/WalletSetup/) and/or [Lightning Network](https://docs.btcpayserver.org/LightningNetwork/) enabled or connected.

## Create a payment provider service plugin (PPSP) 

1. In your Wix site, open your Wix Editor.
2. At the top click on "**Dev Mode**" and the "**Turn on Dev Mode**" button to enable the developer mode.
![Dev Mode](./img/wix/01_wix_dev-mode.png)
3. Now on the left side, click on the `{ }` icon to open the code editor.
4. In the section "Service Plugins" click on the **(+)** sign and select "**Payment**"
![Add payment provider service plugin](./img/wix/02_wix_service-plugin-payment.png)
5. On the following screen, click "**Start now**"
![Start now](./img/wix/03_wix_ppsp-start-now.png)
6. On the legal terms page, check the terms and click "**Accept**"
![Accept terms](./img/wix/04_wix_ppsp-legal-notice.png)
7. Now enter the name of the plugin: "**BTCPay**" (you can use any name but this will make it easier to follow the guide). Then, click "Add & Edit Code":
![Add & Edit Code](./img/wix/05_wix_ppsp-name.png)
8. This created the directory "BTCPay" containing two files: `BTCPay.js` and `BTCPay-config.js` which is open in the editor. 
![BTCPay-config.js](./img/wix/06_wix_ppsp-btcpay-config.png)
9. Next steps are to copy the contents of those two files from our [Git repository](https://github.com/btcpayserver/wix). You can see the same data structure as on your wix editor. In the `BTCPay-config.js` file, paste the code from the same file on our Git repository: [BTCPay-config.js](https://github.com/btcpayserver/wix/blob/main/backend/service-plugins/payment-provider/BTCPay/BTCPay-config.js). Easiest to click the "**Copy raw file**" icon. 
![BTCPay-config.js](./img/wix/07_wix_gh-btcpay-config.png)
10. Make sure you delete example code on the `BTCPay-config.js` file in the wix editor before pasting the new code.
![BTCPay-config.js completed](./img/wix/08_wix_ppsp-btcpay-config-complete.png)
11. Now, open the `BTCPay.js` file in the wix editor and paste the code from our Git repository: [BTCPay.js](https://github.com/btcpayserver/wix/blob/main/backend/service-plugins/payment-provider/BTCPay/BTCPay.js). Do not forget to remove all the example code from the file before pasting the copied code.
![BTCPay.js](./img/wix/09_wix_gh-btcpay.png)
![BTCPay.js](./img/wix/10_wix_ppsp-btcpay.png)
12. Now we need to add the `http-functions.js` file to the `backend` directory. To do so, in the "backend" section of your editor click again on the **(+)** icon and select "**Expose Site API**" which creates the mentioned `http-functions.js` file. Note: If you already have that file present then you can skip this step.
![Create http-functions.js](./img/wix/11_wix_backend-expose-site-api.png)
13. Copy the code from our Git repository: [http-functions.js](https://github.com/btcpayserver/wix/blob/main/backend/http-functions.js). If you already had a `http-functions.js` file, make sure to add the code from the Git repository to the existing file add the copied code below the existing code. If not then make sure you delete all the example code before pasting the code from GitHub.
![http-functions.js](./img/wix/12_wix_backend-http-functions.png)
14. Now the code is done it is important to click on publish to save the changes and make the plugin available.

## Configure the payment service provider plugin (PSPP)
1. Go back to your site's dashboard. On the left menu click on "**Settings**", on that page click "**Accept Payments**"
![Settings](./img/wix/13_wix_settings.png)
![Accept Payments](./img/wix/14_wix_accept-payments.png)
2. On the following page, you should see "Bitcoin Payments with BTCPay" as payment provider. If not, try to refresh the page to clear the Wix cache. Click on "Connect"
![BTCPay](./img/wix/15_wix_list-btcpay.png)
3. You are now on the configuration page. You need to enter the following fields:
   - **BTCPay URL**: The URL of your BTCPay Server instance, e.g. `https://btcpay.example.com`
   - **API Key**: The API key of your BTCPay store
   - **Store ID**: The store ID of your BTCPay store
   - **Webhook Secret**: The webhook secret of your BTCPay store
![Configuration](./img/wix/16_wix_btcpay-config.png)

### BTCPay Server URL
1. First, enter the "**BTCPay Server URL**", in our case `https://testing.btcpay.tech`
2. Next, you need to get the API Key, Store ID, and Webhook Secret from your BTCPay store. To do so, log in to your BTCPay store. We assume you already have a store setup, in our guide here it is called "Wix BTCPay Demo"

### API Key 
1. Go to the API Keys page under "**Account**" -> "**API Keys**" (For BTCPay Server versions prior 2.0 it is under "Account" -> "Manage Account" -> "API Keys"). Click on "**Generate Key**"
![API Keys](./img/wix/17_btcpay-api-key-page.png)
2. Enter a label such as "Wix API Key". 
3. For the permissions, click on the "_**Select specific stores**_" link and select the store you want to connect to Wix, in our example "Wix BTCPay Demo" - for the following permissions: `View invoices`, `Create invoice`, `Modify invoices`, `Modify stores webhooks`, `View your stores`, `Create non-approved pull payments` (used for refunds in the future)
![API Key permissions 1](./img/wix/18_btcpay-api-key-permissions-1.png)
![API Key permissions 2](./img/wix/18_btcpay-api-key-permissions-2.png)
4. Click on "**Generate API Key**" button and on the following page copy the API Key shown at the top
![Copy generated API key](./img/wix/19_btcpay-api-key-copy.png)
5. In your Wix store: paste that copied API key into the "**API Key**" field

### Store ID
1. Go back to your BTCPay store and copy the "**Store ID**". Go to your store and click on "Settings" and copy the Store ID shown
![Copy Store ID](./img/wix/20_btcpay-store-id.png)
2. In your Wix store: paste that copied Store ID into the "**Store ID**" field

### Webhook Secret
1. Go back to your BTCPay store and click on "Settings" -> "Webhooks". Click on "Create Webhook"
![Create webhook page](./img/wix/21_btcpay-webhook-page.png)
2. **Payload URL**: Your Wix store URL where it can be reached combined with a callback path. E.g. `https://example.com/_functions/btcpayTrxWebHook` (replace example.com with your Wix store URL)
3. **Secret**: This is auto-generated by BTCPay, you can show it by clicking on the "eye" icon
4. Copy the "**Secret**" and paste it into the "**Webhook Secret**" field in your Wix store e.g. 'YOURWEBHOOKSECRET' as shown in our example
5. Back on BTCPay webhook page, you can leave the other settings as is
6. Click on "**Add Webhook**" to create the webhook on BTCPay. You should see the "The webhook has been created." message
![Webhook created successfully](./img/wix/22_btcpay-webhook-saved.png)

### Save the configuration
1. Back in your Wix store, click on "**Connect**" to save the configuration
![Save configuration](./img/wix/16_wix_btcpay-config.png)
![Configuration saved](./img/wix/23_wix_btcpay-config-saved.png)

## Testing

You are now ready to test your BTCPay integration on your Wix store. Add some products to the cart and go through the checkout process and select "**Bitcoin payments with BTCPay**"


## Troubleshooting / FAQ

### It does not work, what can I do?
- Make sure you followed the guide step by step and copied the right values into the right places
- In Wix under "**Developer tools**" select "**Logging Tools**" and there open the "**Wix Logs**", it will live log any errors. So try to do the checkout or save the configuration form to see if there is any error.

### After copying the code from the Git repository, I don't see the payment method listed in "Accept payments"
Try to delete the browser cache and reload the page. You can also try to go into editor and click on "Publish" to save the changes. Then reload the payment method list page again.

### How can I change the text of the payment method, "Bitcoin Payments with BTCPay" in the checkout?
You need to go into your Wix Editor and edit the file `BTCPay-config.js`. You can change the text in the `title` field
```
...
hostedPage: {
      title: 'Bitcoin Payments with BTCPay', // change this line
      billingAddressMandatoryFields: ['EMAIL'],
...
```

### I still have a problem, where can I get help?
Feel free to join our support channel over at [https://chat.btcpayserver.org/](https://chat.btcpayserver.org/) if you need help or have any further questions.

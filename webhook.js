#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { SubscriptionClient } = require('@azure/arm-subscriptions');

const SCRIPT_DIR = __dirname;
const INPUT_DIR = path.join(SCRIPT_DIR, 'inputs');
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const ERROR_DIR = path.join(SCRIPT_DIR, 'error_processed');

async function getAzureAccountName(subscriptionId) {
    try {
        const credential = new DefaultAzureCredential();
        const subscriptionClient = new SubscriptionClient(credential);
        const subscription = await subscriptionClient.subscriptions.get(subscriptionId);
        return subscription.displayName || "Unknown Account";
    } catch (error) {
        console.error(`Error fetching Azure account name: ${error.message}`);
        return "Unknown Account";
    }
}

async function getVmDetails(vmName, subscriptionId) {
    try {
        const credential = new DefaultAzureCredential();
        const computeClient = new ComputeManagementClient(credential, subscriptionId);
        const networkClient = new NetworkManagementClient(credential, subscriptionId);

        const vms = await computeClient.virtualMachines.listAll();
        for await (const vm of vms) {
            if (vm.name.toLowerCase() === vmName.toLowerCase()) {
                const resourceGroup = vm.id.split('/')[4];
                const nicId = vm.networkProfile.networkInterfaces[0].id;
                const nicName = nicId.split('/').pop();
                const nic = await networkClient.networkInterfaces.get(resourceGroup, nicName);
                const privateIp = nic.ipConfigurations[0].privateIPAddress;
                let publicIp = "N/A";
                if (nic.ipConfigurations[0].publicIPAddress) {
                    const publicIpId = nic.ipConfigurations[0].publicIPAddress.id;
                    const publicIpName = publicIpId.split('/').pop();
                    const publicIpObj = await networkClient.publicIPAddresses.get(resourceGroup, publicIpName);
                    publicIp = publicIpObj.ipAddress;
                }

                // Fetch the Azure account name dynamically
                const azureAccountName = await getAzureAccountName(subscriptionId);

                return {
                    "SSM Service ID": "SSM-UKPO-1-1-1",
                    "SSM Customer Name": "Post Office",
                    "SSM Host Name": `${vmName}.ssm-customer`,
                    "IP Address": privateIp,
                    "Severity": 3,
                    "Alarm Text": "ALARM: High CPU Utilization 90%",
                    "VM Name": vmName,
                    "Private IP": privateIp,
                    "Public IP": publicIp,
                    "Subscription ID": subscriptionId,
                    "Azure Account Name": azureAccountName
                };
            }
        }
        return null;
    } catch (error) {
        console.error(`Error fetching VM details: ${error.message}`);
        return null;
    }
}

function parseAzureAlert(filePath, fileName) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const alert = JSON.parse(data);

        if (!alert.data || !alert.data.alertContext) {
            throw new Error("Invalid alert format: Missing 'data.alertContext'");
        }

        const vmName = alert.data.alertContext.resourceName || 'Unknown';
        const subscriptionId = alert.data.alertContext.subscriptionId || 'Unknown';

        console.log(`Extracted VM: ${vmName}, Subscription ID: ${subscriptionId}`);
        return { vmName, subscriptionId };
    } catch (error) {
        console.error(`Error processing file ${fileName}:`, error.message);
        fs.renameSync(filePath, path.join(ERROR_DIR, fileName));
        return null;
    }
}

async function processAlertFiles() {
    const files = fs.readdirSync(INPUT_DIR);
    for (const file of files) {
        const filePath = path.join(INPUT_DIR, file);
        console.log(`Processing file: ${filePath}`);
        const alertData = parseAzureAlert(filePath, file);
        if (alertData) {
            const vmDetails = await getVmDetails(alertData.vmName, alertData.subscriptionId);
            if (vmDetails) {
                const outputFilePath = path.join(OUTPUT_DIR, `${file}_vm_profile.json`);
                fs.writeFileSync(outputFilePath, JSON.stringify(vmDetails, null, 4));
                console.log(`Processed and saved: ${outputFilePath}`);
                fs.unlinkSync(filePath);
            } else {
                console.log(`Skipping ${file}: Unable to fetch VM details`);
            }
        }
    }
}

if (require.main === module) {
    processAlertFiles();
}


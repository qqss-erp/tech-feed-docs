# Deployment Break-Points Checklist

| S.No | Break-Points | Description |
|------|--------------|-------------|
| **1** | **Lock the versions of the Images** | - Fix the image versions for the current deployment release. <br/> - Take a snapshot of the existing deployment. |
| **2** | **Create the Frontend Images for all tenants** | - Remove existing build files (`dist`). <br/> - Update tenant name in `Dockerfile` and `nginx.conf`. <br/> - Build the project for each tenant. <br/> - Update the Docker image version. <br/> - Build the Docker image. <br/> - Add a tag name based on previous build. <br/> - Push the image. |
| **3** | **Execute queries for all tenants** | - Get confirmation from QA/Dev for all query changes. <br/> - Get updated tenant list. <br/> - Execute queries tenant-by-tenant. <br/> - Ensure all execution results show success. <br/> - Validate final results against tenant list. |
| **4** | **Add variables to the config-map** | - Collect required environment values. <br/> - Add variables to config-map or values file. <br/> - Ensure variables exist across all namespaces. |
| **5** | **Switch the image version for all tenants** | - Update image tags for Frontend and Backend pods. <br/> - Verify updated versions across all namespaces. |
| **6** | **Validate live environment after deployment** | - Check whether frontend loads correctly. <br/> - Test login functionality if possible. <br/> - Ensure post-deployment testing is performed. |

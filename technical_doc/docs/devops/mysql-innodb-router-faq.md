---
title: MySQL InnoDB Router FAQ
sidebar_position: 1
---

# MySQL InnoDB Cluster and Router FAQ

## Q1) Why does MySQL Router keep logging: `Waiting for 3 cluster instances to become available`?

Router is configured to wait for all cluster members before becoming ready.  
If `MYSQL_INNODB_CLUSTER_MEMBERS=3`, Router will remain in wait-loop until 3 members are active in InnoDB Cluster metadata.

## Q2) What was the root cause in our incident?

Two secondary members (`mysql-1`, `mysql-2`) had schema/data drift and failed Group Replication apply with conversion errors:

- `Column ... cannot be converted from varchar(50) to varchar(200 utf8mb4)`

Because incremental recovery could not apply pending transactions, those members stayed missing/offline.  
Router then continued waiting for 3 healthy instances.

## Q3) How do I verify this quickly?

From `mysqlsh` on primary:

```javascript
cluster = dba.getCluster('prodCluster')
cluster.status({extended: 1})
```

Typical bad state:

- `status: OK_NO_TOLERANCE_PARTIAL`
- one or more nodes as `(MISSING)` or `group_replication is stopped`
- applier errors in `instanceErrors` / `applierLastErrors`

## Q4) What is the fix?

Use clone-based recovery for drifted members and rescan metadata.

```javascript
cluster = dba.getCluster('prodCluster')
cluster.rescan({addInstances: "auto", removeInstances: "auto", updateTopologyMode: true})

cluster.rejoinInstance('root@mysql-1.mysql-headless.innodb-cluster.svc.cluster.local:3306', {
  recoveryMethod: 'clone'
})

cluster.rejoinInstance('root@mysql-2.mysql-headless.innodb-cluster.svc.cluster.local:3306', {
  recoveryMethod: 'clone'
})

cluster.status({extended: 1})
```

If `rejoinInstance()` says the instance is not in metadata, use:

```javascript
cluster.addInstance('root@mysql-2.mysql-headless.innodb-cluster.svc.cluster.local:3306', {
  recoveryMethod: 'clone'
})
```

## Q5) What if clone/rejoin fails with `Error 1410 ... not allowed to create a user with GRANT`?

Check grants of the account used in `mysqlsh`:

```sql
\sql
SELECT CURRENT_USER();
SHOW GRANTS FOR CURRENT_USER();
```

Use an account with sufficient AdminAPI privileges (including ability to manage required recovery/clone users), then retry.

## Q6) How do I confirm full recovery?

Success criteria:

- all 3 members are `ONLINE`
- cluster status is `OK`
- Router pods become Ready and stop wait-loop logs

Kubernetes checks:

```bash
kubectl -n innodb-cluster get pods
kubectl -n innodb-cluster logs deploy/mysql-router
```

## Q7) Can we set `MYSQL_INNODB_CLUSTER_MEMBERS=1` and run continuously?

Yes, Router can run with `1` and serve traffic when only one member is available.  
But for production HA posture, this should usually be temporary.

Guidance:

- Use `1` during outage recovery or maintenance windows to bring application traffic back faster.
- Switch back to `3` after all cluster members are healthy and stable.
- Keeping `1` permanently removes the startup guard that enforces full cluster availability.

Update and rollout:

```bash
kubectl apply -f k8s/mysql-router-deployment.yaml
kubectl -n innodb-cluster rollout restart deploy/mysql-router
kubectl -n innodb-cluster rollout status deploy/mysql-router
```
